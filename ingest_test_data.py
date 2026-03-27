"""
Ingest test PDFs into vector store for evaluation.
"""

from pathlib import Path
from src.ingest import IngestionPipeline


def main():
    test_data_dir = Path("test_data")
    classroom_id = "test_classroom"
    
    if not test_data_dir.exists():
        print(f"❌ {test_data_dir} not found")
        return
    
    print(f"📦 Initializing ingestion pipeline for classroom: {classroom_id}")
    pipeline = IngestionPipeline(classroom_id=classroom_id)
    
    # Find all PDFs
    pdf_files = sorted(test_data_dir.glob("*.pdf"))
    print(f"📂 Found {len(pdf_files)} PDFs to ingest")
    
    if not pdf_files:
        print("❌ No PDF files found in test_data")
        return
    
    # Ingest each PDF
    for pdf_path in pdf_files:
        print(f"\n📄 Ingesting: {pdf_path.name}")
        try:
            pipeline.process_pdf(pdf_path, source_filename=pdf_path.name, force_reindex=True)
            print(f"   ✅ Successfully ingested")
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print(f"\n✅ Ingestion complete for classroom: {classroom_id}")


if __name__ == "__main__":
    main()
