import uuid
import os
from pathlib import Path
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
import chromadb

try:
    from .config import DATA_DIR, EMBED_MODEL, get_classroom_vector_db_path, normalize_classroom_id
except ImportError:
    # Supports running as: python src/ingest.py
    from config import DATA_DIR, EMBED_MODEL, get_classroom_vector_db_path, normalize_classroom_id


def split_text(text, chunk_size, chunk_overlap):
    """Split text into overlapping chunks without external splitter dependencies."""
    if not text:
        return []

    clean_text = " ".join(text.split())
    if len(clean_text) <= chunk_size:
        return [clean_text]

    chunks = []
    start = 0
    step = max(1, chunk_size - chunk_overlap)

    while start < len(clean_text):
        end = min(len(clean_text), start + chunk_size)
        chunk = clean_text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(clean_text):
            break
        start += step

    return chunks

class IngestionPipeline:
    def __init__(self, classroom_id: str):
        self.classroom_id = normalize_classroom_id(classroom_id)
        self.model = SentenceTransformer(EMBED_MODEL)
        self.db_path = get_classroom_vector_db_path(self.classroom_id)
        os.makedirs(self.db_path, exist_ok=True)
        self.client = chromadb.PersistentClient(path=self.db_path)
        
        # True classroom isolation: each classroom has its own persistent DB directory.
        self.collection_name = "materials"
        # Two-tier splitter settings
        # Parent chunks (2000 chars) preserve the larger context (why/how).
        self.parent_chunk_size = 2000
        self.parent_chunk_overlap = 200
        # Child chunks (400 chars) are meant to be highly searchable (what/where).
        self.child_chunk_size = 400
        self.child_chunk_overlap = 50

    def process_pdf(self, pdf_file: Path, source_filename: str = None, force_reindex: bool = True):
        """Process one PDF into this classroom's isolated collection."""
        pdf_path = Path(pdf_file)
        source_name = source_filename or pdf_path.name
        collection = self.client.get_or_create_collection(name=self.collection_name)

        print(f"Ingesting: {source_name} into collection: {self.collection_name}")
        
        # Re-indexing mechanism: delete old data for this source_file to prevent duplicates
        if force_reindex:
            try:
                results = collection.get(where={"source_file": source_name}, include=[])
                if results and results.get("ids") and len(results["ids"]) > 0:
                    print(f"Found {len(results['ids'])} existing chunks for {source_name}. Deleting for re-index...")
                    collection.delete(ids=results["ids"])
            except Exception as e:
                print(f"Delete existing docs failed (maybe collection empty): {e}")

        reader = PdfReader(str(pdf_path))

        for page_index, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if not page_text.strip():
                continue

            page_meta = {
                "source": str(pdf_path),
                "source_file": source_name,
                "page": page_index + 1,
                "classroom_id": self.classroom_id,
            }

            # 1. Create Parent Chunks (The "Why" and Context)
            parents = split_text(
                page_text,
                chunk_size=self.parent_chunk_size,
                chunk_overlap=self.parent_chunk_overlap,
            )

            for parent in parents:
                parent_id = str(uuid.uuid4())
                parent_text = parent

                # 2. Create Child Chunks (The "What" for searching)
                children = split_text(
                    parent_text,
                    chunk_size=self.child_chunk_size,
                    chunk_overlap=self.child_chunk_overlap,
                )
                if not children:
                    continue

                # Generate embeddings for children ONLY for high-precision matching
                embeddings = self.model.encode(children).tolist()

                child_metadatas = []
                for child_text in children:
                    meta = page_meta.copy()
                    meta.update({
                        "parent_id": parent_id,
                        "parent_text": parent_text,  # Full context for the LLM
                    })
                    child_metadatas.append(meta)

                collection.add(
                    ids=[f"child_{uuid.uuid4().hex}" for _ in children],
                    embeddings=embeddings,
                    metadatas=child_metadatas,
                    documents=children
                )
        print(f"Ingestion complete for {source_name} into {self.collection_name}.")


    def process_pdfs(self):
        pdf_files = list(Path(DATA_DIR).glob('**/*.pdf'))
        for pdf_file in pdf_files:
            self.process_pdf(pdf_file)

if __name__ == "__main__":
    pipeline = IngestionPipeline(classroom_id="default")
    pipeline.process_pdfs()