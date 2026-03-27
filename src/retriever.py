import chromadb
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from .config import EMBED_MODEL, SIMILARITY_THRESHOLD, get_classroom_vector_db_path, normalize_classroom_id


def _tokenize_for_bm25(text):
    """Tokenize while dropping very short/noisy tokens that cause random BM25 ties."""
    if not text:
        return []
    return [tok for tok in text.lower().split() if len(tok) >= 2]

class HybridParentRetriever:
    def __init__(self, classroom_id: str):
        self.classroom_id = normalize_classroom_id(classroom_id)
        self.model = SentenceTransformer(EMBED_MODEL)
        
        # Primary path: dedicated vector DB directory per classroom.
        classroom_db_path = get_classroom_vector_db_path(self.classroom_id)
        self.client = chromadb.PersistentClient(path=classroom_db_path)
        self.collection = None
        try:
            self.collection = self.client.get_collection(name="materials")
        except Exception:
            # Do not auto-create/fallback: strict isolation only.
            all_data = {"documents": [], "metadatas": []}
        else:
            all_data = self.collection.get(where={"classroom_id": self.classroom_id})

        # Build BM25 index from child chunks
        self.child_documents = all_data.get('documents', []) or []
        self.metadatas = all_data.get('metadatas', []) or []
        
        if self.child_documents:
            tokenized_corpus = [_tokenize_for_bm25(doc) for doc in self.child_documents]
            self.bm25 = BM25Okapi(tokenized_corpus)
        else:
            self.bm25 = None

    def retrieve(self, query, top_k=3, score_threshold=None):
        # Out-of-Scope Rejection Logic: If no docs exist, return []
        if not self.collection or not self.child_documents or not self.bm25:
            return []

        if score_threshold is None:
            score_threshold = SIMILARITY_THRESHOLD

        # No need for user filter since collections are isolated
        
        # A. Semantic Search (Vector)
        query_embedding = self.model.encode([query]).tolist()
        vector_results = self.collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k * 3, len(self.child_documents)),
            where={"classroom_id": self.classroom_id},
            include=["documents", "metadatas", "distances"]
        )

        # B. Keyword Search (BM25)
        tokenized_query = _tokenize_for_bm25(query)
        bm25_scores = None
        top_bm25_indices = []
        max_bm25_score = 0.0
        if tokenized_query:
            bm25_scores = self.bm25.get_scores(tokenized_query)
            if len(bm25_scores) > 0:
                max_bm25_score = float(np.max(bm25_scores))
            # If all scores are zero, BM25 provides no signal.
            if max_bm25_score > 0:
                num_bm25_results = min(top_k * 3, len(bm25_scores))
                top_bm25_indices = np.argsort(bm25_scores)[::-1][:num_bm25_results]

        # C. Reciprocal Rank Fusion (RRF)
        fused_scores = {}
        parent_payloads = {}
        has_strong_vector_match = False
        
        if vector_results['documents'] and vector_results['documents'][0]:
            distances = vector_results.get('distances', [[]])[0]
            vec_metadatas = vector_results.get('metadatas', [[]])[0]
            for rank, doc_content in enumerate(vector_results['documents'][0]):
                meta = vec_metadatas[rank] if rank < len(vec_metadatas) else {}
                if str(meta.get("classroom_id", "")) != self.classroom_id:
                    continue
                if rank < len(distances):
                    dist = distances[rank]
                    # Check distance threshold for L2: smaller is better.
                    if dist <= score_threshold:
                        has_strong_vector_match = True
                    else:
                        continue # Drop poor matches

                parent_id = meta.get("parent_id")
                if not parent_id:
                    continue
                fused_scores[parent_id] = fused_scores.get(parent_id, 0) + (1 / (rank + 60))
                parent_payloads[parent_id] = meta

        for rank, idx in enumerate(top_bm25_indices):
            raw_score = bm25_scores[idx] if bm25_scores is not None else 0
            if raw_score <= 0 or (max_bm25_score > 0 and raw_score < 0.2 * max_bm25_score):
                continue
            meta = self.metadatas[idx]
            if str(meta.get("classroom_id", "")) != self.classroom_id:
                continue
            parent_id = meta.get("parent_id")
            if not parent_id:
                continue
            fused_scores[parent_id] = fused_scores.get(parent_id, 0) + (1 / (rank + 60))
            parent_payloads[parent_id] = meta

        # Out-of-Scope Fallback: If no strong matches from both Vector and BM25
        if not fused_scores and max_bm25_score < 1.5 and not has_strong_vector_match:
            return []

        # Sort and pick top results
        sorted_parent_ids = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)

        if not sorted_parent_ids:
            return []

        # D. Return top parent chunks with grounded metadata
        final_docs = []

        for parent_id, _ in sorted_parent_ids:
            if len(final_docs) >= top_k:
                break
            meta = parent_payloads.get(parent_id)
            if not meta:
                continue
            if str(meta.get("classroom_id", "")) != self.classroom_id:
                continue
            final_docs.append({
                'content': meta.get('parent_text', ''), # LLM sees the larger context
                'metadata': {
                    'source_file': meta.get('source_file', 'Unknown'),
                    'page': meta.get('page', 0)
                }
            })
        
        return final_docs