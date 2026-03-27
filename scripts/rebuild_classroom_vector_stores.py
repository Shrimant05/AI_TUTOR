import shutil
from pathlib import Path

from src.config import DATA_DIR, get_classroom_vector_db_path, normalize_classroom_id
from src.ingest import IngestionPipeline


def rebuild_for_classroom(classroom_id: str) -> None:
    normalized_id = normalize_classroom_id(classroom_id)
    class_dir = Path(DATA_DIR) / normalized_id
    if not class_dir.exists() or not class_dir.is_dir():
        print(f"[skip] classroom={normalized_id} no folder at {class_dir}")
        return

    db_path = Path(get_classroom_vector_db_path(normalized_id))
    if db_path.exists():
        shutil.rmtree(db_path)
        print(f"[clean] removed {db_path}")

    pipeline = IngestionPipeline(classroom_id=normalized_id)
    pdfs = sorted(class_dir.glob("*.pdf")) + sorted(class_dir.glob("*.txt"))
    if not pdfs:
        print(f"[skip] classroom={normalized_id} no files to ingest")
        return

    for f in pdfs:
        pipeline.process_pdf(f, source_filename=f.name, force_reindex=False)
    print(f"[done] classroom={normalized_id} indexed_files={len(pdfs)}")


def main() -> None:
    root = Path(DATA_DIR)
    if not root.exists():
        print(f"DATA_DIR does not exist: {root}")
        return

    classroom_dirs = [d.name for d in sorted(root.iterdir()) if d.is_dir()]
    if not classroom_dirs:
        print("No classroom directories found under data/pdf_files")
        return

    for classroom_id in classroom_dirs:
        rebuild_for_classroom(classroom_id)


if __name__ == "__main__":
    main()
