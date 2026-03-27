import chromadb
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from .config import DB_DIR, EMBED_MODEL, SIMILARITY_THRESHOLD


def _tokenize_for_bm25(text):
    """Tokenize while dropping very short/noisy tokens that cause random BM25 ties."""
    if not text:
        return []
    return [tok for tok in text.lower().split() if len(tok) >= 2]

class HybridParentRetriever:
    def __init__(self, classroom_id: str):
        self.model = SentenceTransformer(EMBED_MODEL)
        self.client = chromadb.PersistentClient(path=DB_DIR)
        
        # Classroom-Level Isolation
        collection_name = f"classroom_{classroom_id}"
        try:
            self.collection = self.client.get_collection(name=collection_name)
        except Exception:
            # Fallback for when collection doesn't exist to prevent crash
            self.collection = self.client.get_or_create_collection(name=collection_name)
        
        # Build BM25 index from child chunks
        all_data = self.collection.get()
        self.child_documents = all_data.get('documents', []) or []
        self.metadatas = all_data.get('metadatas', []) or []
        
        if self.child_documents:
            tokenized_corpus = [_tokenize_for_bm25(doc) for doc in self.child_documents]
            self.bm25 = BM25Okapi(tokenized_corpus)
        else:
            self.bm25 = None

    def retrieve(self, query, top_k=3, score_threshold=None):
        # Out-of-Scope Rejection Logic: If no docs exist, return []
        if not self.child_documents or not self.bm25:
            return []

        if score_threshold is None:
            score_threshold = SIMILARITY_THRESHOLD

        # No need for user filter since collections are isolated
        
        # A. Semantic Search (Vector)
        query_embedding = self.model.encode([query]).tolist()
        vector_results = self.collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k * 3, len(self.child_documents)),
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
        has_strong_vector_match = False
        
        if vector_results['documents'] and vector_results['documents'][0]:
            distances = vector_results.get('distances', [[]])[0]
            for rank, doc_content in enumerate(vector_results['documents'][0]):
                if rank < len(distances):
                    dist = distances[rank]
                    # Check distance threshold for L2: smaller is better.
                    if dist <= score_threshold:
                        has_strong_vector_match = True
                    else:
                        continue # Drop poor matches
                        
                fused_scores[doc_content] = fused_scores.get(doc_content, 0) + (1 / (rank + 60))

        for rank, idx in enumerate(top_bm25_indices):
            raw_score = bm25_scores[idx] if bm25_scores is not None else 0
            if raw_score <= 0 or (max_bm25_score > 0 and raw_score < 0.2 * max_bm25_score):
                continue
            doc_content = self.child_documents[idx]
            fused_scores[doc_content] = fused_scores.get(doc_content, 0) + (1 / (rank + 60))

        # Out-of-Scope Fallback: If no strong matches from both Vector and BM25
        if not fused_scores and max_bm25_score < 1.5 and not has_strong_vector_match:
            return []

        # Sort and pick top results
        sorted_child_contents = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)

        if not sorted_child_contents:
            return []

        # D. Map Children back to Parents (allow multiple topics/sources)
        final_docs = []
        seen_parents = set()

        for child_content, _ in sorted_child_contents:
            if len(final_docs) >= top_k:
                break
                
            child_idx = self.child_documents.index(child_content)
            meta = self.metadatas[child_idx]
            parent_id = meta['parent_id']

            # Removed the preferred_source check so that we can retrieve across multiple topics/files

            if parent_id not in seen_parents:
                final_docs.append({
                    'content': meta['parent_text'], # LLM sees the larger context
                    'metadata': {
                        'source_file': meta['source_file'],
                        'page': meta['page']
                    }
                })
                seen_parents.add(parent_id)
        
        return final_docs