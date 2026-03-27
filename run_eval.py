import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from src.main import socratic_agent
from src.retriever import HybridParentRetriever


CITATION_PATTERN = re.compile(r"\(File:\s*[^,]+,\s*Page:\s*[^\)]+\)", re.IGNORECASE)


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _normalize_text(text: str) -> str:
    return (text or "").strip().lower()


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                item = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {idx}: {exc}") from exc

            if "question" not in item or not str(item["question"]).strip():
                raise ValueError(f"Line {idx} is missing required field 'question'.")

            item.setdefault("id", f"q{len(rows) + 1}")
            item.setdefault("requires_citation", True)
            item.setdefault("requires_question", True)
            item.setdefault("no_direct_answer", False)
            rows.append(item)

    if not rows:
        raise ValueError("Evaluation file is empty.")
    return rows


def _match_retrieval(
    results: Sequence[Dict[str, Any]],
    gold_sources: Sequence[str],
    gold_pages: Sequence[int],
    gold_pairs: Sequence[Sequence[Any]],
) -> Tuple[bool, List[str]]:
    matches: List[str] = []
    normalized_gold_sources = {_normalize_text(s) for s in gold_sources if str(s).strip()}
    normalized_gold_pages = {int(p) for p in gold_pages if str(p).strip()}

    normalized_pairs = set()
    for pair in gold_pairs:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        src, page = pair
        try:
            normalized_pairs.add((_normalize_text(str(src)), int(page)))
        except (TypeError, ValueError):
            continue

    for res in results:
        meta = res.get("metadata", {}) if isinstance(res, dict) else {}
        src = _normalize_text(str(meta.get("source_file", "")))
        page = meta.get("page")
        try:
            page_num = int(page)
        except (TypeError, ValueError):
            page_num = None

        if normalized_pairs and page_num is not None and (src, page_num) in normalized_pairs:
            matches.append(f"pair:{src}:{page_num}")
            continue
        if normalized_gold_sources and src in normalized_gold_sources:
            matches.append(f"source:{src}")
            continue
        if normalized_gold_pages and page_num in normalized_gold_pages:
            matches.append(f"page:{page_num}")
            continue

    return (len(matches) > 0, matches)


def _score_response(item: Dict[str, Any], response: str) -> Dict[str, Any]:
    text = response or ""
    lower_text = _normalize_text(text)

    expected_keywords = [str(x).strip().lower() for x in _as_list(item.get("expected_keywords")) if str(x).strip()]
    forbid_phrases = [str(x).strip().lower() for x in _as_list(item.get("forbid_phrases")) if str(x).strip()]

    citation_present = bool(CITATION_PATTERN.search(text))
    guiding_question_present = "?" in text

    keyword_hits = sum(1 for kw in expected_keywords if kw in lower_text)
    keyword_recall = (keyword_hits / len(expected_keywords)) if expected_keywords else None

    forbidden_hit = any(phrase in lower_text for phrase in forbid_phrases)

    direct_answer_violation = False
    if item.get("no_direct_answer", False):
        expected_final_answers = [
            str(x).strip().lower() for x in _as_list(item.get("expected_final_answer")) if str(x).strip()
        ]
        direct_answer_markers = (
            "the answer is",
            "final answer",
            "therefore the answer",
            "hence the answer",
        )
        direct_marker_hit = any(marker in lower_text for marker in direct_answer_markers)
        exact_answer_hit = any(ans in lower_text for ans in expected_final_answers)
        direct_answer_violation = direct_marker_hit or exact_answer_hit

    citation_pass = (not item.get("requires_citation", True)) or citation_present
    question_pass = (not item.get("requires_question", True)) or guiding_question_present
    content_pass = (not forbid_phrases) or (not forbidden_hit)
    no_direct_pass = (not item.get("no_direct_answer", False)) or (not direct_answer_violation)

    return {
        "citation_present": citation_present,
        "guiding_question_present": guiding_question_present,
        "keyword_recall": keyword_recall,
        "forbidden_phrase_hit": forbidden_hit,
        "direct_answer_violation": direct_answer_violation,
        "citation_pass": citation_pass,
        "question_pass": question_pass,
        "content_pass": content_pass,
        "no_direct_pass": no_direct_pass,
    }


def evaluate(eval_items: List[Dict[str, Any]], top_k: int) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    retriever = HybridParentRetriever()
    rows: List[Dict[str, Any]] = []

    retrieval_hits = 0
    citation_hits = 0
    question_hits = 0
    content_hits = 0
    no_direct_hits = 0
    full_behavior_hits = 0
    keyword_scores: List[float] = []

    for item in eval_items:
        question = str(item["question"]).strip()
        retrieved = retriever.retrieve(question, top_k=top_k)

        matched, retrieval_matches = _match_retrieval(
            retrieved,
            gold_sources=_as_list(item.get("gold_sources")),
            gold_pages=_as_list(item.get("gold_pages")),
            gold_pairs=_as_list(item.get("gold_source_page_pairs")),
        )
        retrieval_hits += int(matched)

        # Evaluate single-turn behavior by default.
        response = socratic_agent(question, retriever, history=[])
        answer_scores = _score_response(item, response)

        citation_hits += int(answer_scores["citation_pass"])
        question_hits += int(answer_scores["question_pass"])
        content_hits += int(answer_scores["content_pass"])
        no_direct_hits += int(answer_scores["no_direct_pass"])

        behavior_ok = (
            answer_scores["citation_pass"]
            and answer_scores["question_pass"]
            and answer_scores["content_pass"]
            and answer_scores["no_direct_pass"]
        )
        full_behavior_hits += int(behavior_ok)

        if answer_scores["keyword_recall"] is not None:
            keyword_scores.append(float(answer_scores["keyword_recall"]))

        top_sources = []
        for res in retrieved:
            meta = res.get("metadata", {})
            top_sources.append(f"{meta.get('source_file', 'Unknown')}#p{meta.get('page', 'Unknown')}")

        rows.append(
            {
                "id": item.get("id"),
                "question": question,
                "retrieval_hit": int(matched),
                "retrieval_matches": "; ".join(retrieval_matches),
                "top_sources": " | ".join(top_sources),
                "citation_present": int(answer_scores["citation_present"]),
                "guiding_question_present": int(answer_scores["guiding_question_present"]),
                "forbidden_phrase_hit": int(answer_scores["forbidden_phrase_hit"]),
                "direct_answer_violation": int(answer_scores["direct_answer_violation"]),
                "keyword_recall": ""
                if answer_scores["keyword_recall"] is None
                else f"{answer_scores['keyword_recall']:.4f}",
                "behavior_pass": int(behavior_ok),
                "response": response.replace("\n", " ").strip(),
            }
        )

    n = len(eval_items)
    summary = {
        "num_samples": float(n),
        "retrieval_hit_at_k": retrieval_hits / n,
        "citation_compliance": citation_hits / n,
        "guiding_question_rate": question_hits / n,
        "content_safety_rate": content_hits / n,
        "no_direct_answer_rate": no_direct_hits / n,
        "behavior_pass_rate": full_behavior_hits / n,
        "avg_keyword_recall": (sum(keyword_scores) / len(keyword_scores)) if keyword_scores else -1.0,
    }

    retrieval_score = summary["retrieval_hit_at_k"]
    behavior_score = summary["behavior_pass_rate"]
    keyword_score = max(0.0, summary["avg_keyword_recall"])

    # Weighted overall score for this tutor setup.
    summary["overall_score"] = 0.5 * retrieval_score + 0.3 * behavior_score + 0.2 * keyword_score

    return rows, summary


def _write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return

    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate retrieval and Socratic behavior for the AI tutor RAG system.")
    parser.add_argument(
        "--eval-file",
        default="data/eval_set.jsonl",
        help="Path to JSONL evaluation set.",
    )
    parser.add_argument("--top-k", type=int, default=3, help="Top-k documents for retrieval hit calculation.")
    parser.add_argument(
        "--out-csv",
        default="data/eval_results.csv",
        help="Path to per-sample CSV results.",
    )
    args = parser.parse_args()

    eval_path = Path(args.eval_file)
    if not eval_path.exists():
        raise FileNotFoundError(
            f"Evaluation file not found: {eval_path}. Create it from data/eval_set.sample.jsonl and rerun."
        )

    items = _load_jsonl(eval_path)
    rows, summary = evaluate(items, top_k=args.top_k)

    out_csv = Path(args.out_csv)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    _write_csv(out_csv, rows)

    print("=== RAG Evaluation Summary ===")
    print(f"Samples: {int(summary['num_samples'])}")
    print(f"Retrieval Hit@{args.top_k}: {summary['retrieval_hit_at_k']:.3f}")
    print(f"Citation compliance: {summary['citation_compliance']:.3f}")
    print(f"Guiding-question rate: {summary['guiding_question_rate']:.3f}")
    print(f"Content safety rate: {summary['content_safety_rate']:.3f}")
    print(f"No-direct-answer rate: {summary['no_direct_answer_rate']:.3f}")
    print(f"Behavior pass rate: {summary['behavior_pass_rate']:.3f}")

    if summary["avg_keyword_recall"] >= 0:
        print(f"Average keyword recall: {summary['avg_keyword_recall']:.3f}")
    else:
        print("Average keyword recall: N/A (no expected_keywords provided)")

    print(f"Overall score: {summary['overall_score']:.3f}")
    print(f"Per-sample report saved to: {out_csv}")


if __name__ == "__main__":
    main()
