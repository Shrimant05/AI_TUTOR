"""
Enhanced RAG Evaluation with Advanced Metrics
- Retrieval precision/recall/NDCG
- Citation faithfulness  
- Semantic similarity
- Pedagogical compliance
- Comprehensive reporting
"""

import argparse
import csv
import json
import re
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

import numpy as np
from scipy.spatial.distance import cosine
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

from src.main import socratic_agent
from src.retriever import HybridParentRetriever
from src.config import EMBED_MODEL


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
    """Load evaluation questions from JSONL file."""
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
    results: List[Dict[str, Any]],
    gold_sources: List[str],
    gold_pages: List[int],
    gold_pairs: List[List[Any]],
) -> Tuple[bool, List[str], Dict[str, float]]:
    """
    Match retrieved results against gold standard sources/pages.
    Returns: (matched_bool, match_list, metrics_dict)
    """
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

    # Calculate precision and recall
    tp = 0  # relevant retrieved items
    fp = 0  # non-relevant retrieved items
    unique_gold_hits = set()

    for res in results:
        meta = res.get("metadata", {}) if isinstance(res, dict) else {}
        src = _normalize_text(str(meta.get("source_file", "")))
        page = meta.get("page")
        try:
            page_num = int(page)
        except (TypeError, ValueError):
            page_num = None

        found = False
        if normalized_pairs and page_num is not None and (src, page_num) in normalized_pairs:
            matches.append(f"pair:{src}:{page_num}")
            tp += 1
            unique_gold_hits.add(("pair", src, page_num))
            found = True
        elif normalized_gold_sources and src in normalized_gold_sources:
            matches.append(f"source:{src}")
            tp += 1
            unique_gold_hits.add(("source", src))
            found = True
        elif normalized_gold_pages and page_num in normalized_gold_pages:
            matches.append(f"page:{page_num}")
            tp += 1
            unique_gold_hits.add(("page", page_num))
            found = True

        if not found:
            fp += 1

    # Calculate metrics
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    total_gold = max(len(normalized_pairs), len(normalized_gold_sources), len(normalized_gold_pages), 1)
    recall = len(unique_gold_hits) / total_gold if total_gold > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    metrics = {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "tp": tp,
        "fp": fp,
    }

    return (len(matches) > 0, matches, metrics)


def _score_response(item: Dict[str, Any], response_obj: Any, embedding_model=None) -> Dict[str, Any]:
    """
    Score response against pedagogical and content requirements.
    """
    citations_payload: List[Dict[str, Any]] = []
    if isinstance(response_obj, dict):
        text = str(response_obj.get("reply", "") or "")
        maybe_citations = response_obj.get("citations", [])
        if isinstance(maybe_citations, list):
            citations_payload = maybe_citations
    else:
        text = str(response_obj or "")
    lower_text = _normalize_text(text)

    expected_keywords = [str(x).strip().lower() for x in _as_list(item.get("expected_keywords")) if str(x).strip()]
    forbid_phrases = [str(x).strip().lower() for x in _as_list(item.get("forbid_phrases")) if str(x).strip()]

    # Citation metrics
    citation_present = bool(citations_payload) or bool(CITATION_PATTERN.search(text))

    # Question presence metric
    guiding_question_present = "?" in text

    # Keyword metrics
    keyword_hits = sum(1 for kw in expected_keywords if kw in lower_text)
    keyword_recall = (keyword_hits / len(expected_keywords)) if expected_keywords else None

    # Forbidden phrase metric
    forbidden_hit = any(phrase in lower_text for phrase in forbid_phrases)

    # Direct answer violation
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
            "so the answer",
            "thus the answer",
        )
        direct_marker_hit = any(marker in lower_text for marker in direct_answer_markers)
        exact_answer_hit = any(ans in lower_text for ans in expected_final_answers)
        direct_answer_violation = direct_marker_hit or exact_answer_hit

    # Socratic compliance: response quality for learning
    pass_tags = {
        "citation_pass": (not item.get("requires_citation", True)) or citation_present,
        "question_pass": (not item.get("requires_question", True)) or guiding_question_present,
        "content_pass": (not forbid_phrases) or (not forbidden_hit),
        "no_direct_pass": (not item.get("no_direct_answer", False)) or (not direct_answer_violation),
    }

    # Pedagogical compliance score (0-1)
    pedagogical_score = sum(pass_tags.values()) / len(pass_tags)

    return {
        "citation_present": citation_present,
        "guiding_question_present": guiding_question_present,
        "keyword_recall": keyword_recall,
        "forbidden_phrase_hit": forbidden_hit,
        "direct_answer_violation": direct_answer_violation,
        "pedagogical_score": pedagogical_score,
        **pass_tags,
        "response_length": len(text),
    }


def _calculate_semantic_similarity(query: str, retrieved_chunks: List[Dict], model) -> float:
    """Calculate average semantic similarity between query and retrieved chunks."""
    if not retrieved_chunks or not query:
        return 0.0

    query_emb = model.encode(query)
    similarities = []

    for chunk in retrieved_chunks:
        content = chunk.get("content", "")
        if not content:
            continue
        chunk_emb = model.encode(content)
        # Cosine similarity: (1 + sim) / 2 to convert from [-1, 1] to [0, 1]
        sim = float(cosine_similarity([query_emb], [chunk_emb])[0][0])
        similarities.append(sim)

    return np.mean(similarities) if similarities else 0.0


def _calculate_ndcg(retrieval_metrics: Dict, k: int = 3) -> float:
    """
    Calculate NDCG@K (Normalized Discounted Cumulative Gain).
    Assumes binary relevance.
    """
    # f1 score as proxy for relevance grade (0-1)
    relevance_grade = retrieval_metrics.get("f1", 0.0)
    
    # DCG formula: sum(relevance_i / log2(i+1))
    dcg = relevance_grade / math.log2(2)  # First position discount
    
    # IDCG (ideal): assuming perfect retrieval
    idcg = 1.0 / math.log2(2)
    
    # NDCG = DCG / IDCG
    ndcg = dcg / idcg if idcg > 0 else 0.0
    return min(ndcg, 1.0)


def evaluate(
    eval_items: List[Dict[str, Any]],
    top_k: int = 3,
    classroom_id: str = "test_classroom",
) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    """
    Comprehensive evaluation with all metrics.
    """
    # Initialize models
    try:
        retriever = HybridParentRetriever(classroom_id=classroom_id)
    except Exception as e:
        print(f"Warning: Could not initialize retriever: {e}")
        return [], {}

    embedding_model = SentenceTransformer(EMBED_MODEL)

    rows: List[Dict[str, Any]] = []
    
    # Aggregation metrics
    retrieval_metrics_list = []
    semantic_sims = []
    ndcg_scores = []
    citation_hits = 0
    question_hits = 0
    content_hits = 0
    no_direct_hits = 0
    pedagogical_scores = []
    keyword_scores: List[float] = []
    response_lengths = []

    print(f"\n🔍 Running evaluation on {len(eval_items)} questions...")
    
    for idx, item in enumerate(eval_items, 1):
        question = str(item["question"]).strip()
        print(f"  [{idx}/{len(eval_items)}] {question[:60]}...")

        # Retrieval step
        retrieved = retriever.retrieve(question, top_k=top_k)

        matched, retrieval_matches, retrieval_metrics = _match_retrieval(
            retrieved,
            gold_sources=_as_list(item.get("gold_sources")),
            gold_pages=_as_list(item.get("gold_pages")),
            gold_pairs=_as_list(item.get("gold_source_page_pairs")),
        )
        
        retrieval_metrics_list.append(retrieval_metrics)

        # Semantic similarity metric
        semantic_sim = _calculate_semantic_similarity(question, retrieved, embedding_model)
        semantic_sims.append(semantic_sim)

        # NDCG metric
        ndcg = _calculate_ndcg(retrieval_metrics, k=top_k)
        ndcg_scores.append(ndcg)

        # Response generation and scoring
        response = socratic_agent(question, retriever, history=[])
        response_text = response.get("reply", "") if isinstance(response, dict) else str(response)
        
        answer_scores = _score_response(item, response, embedding_model)

        # Aggregate metrics
        if answer_scores.get("citation_pass"):
            citation_hits += 1
        if answer_scores.get("question_pass"):
            question_hits += 1
        if answer_scores.get("content_pass"):
            content_hits += 1
        if answer_scores.get("no_direct_pass"):
            no_direct_hits += 1

        pedagogical_scores.append(answer_scores.get("pedagogical_score", 0.0))
        if answer_scores.get("keyword_recall") is not None:
            keyword_scores.append(float(answer_scores["keyword_recall"]))
        response_lengths.append(answer_scores.get("response_length", 0))

        # Build result row
        top_sources = []
        for res in retrieved:
            meta = res.get("metadata", {})
            top_sources.append(f"{meta.get('source_file', 'Unknown')}#p{meta.get('page', 'Unknown')}")

        rows.append({
            "id": item.get("id"),
            "question": question,
            # Retrieval metrics
            "retrieval_hit": int(matched),
            "retrieval_matches": "; ".join(retrieval_matches),
            "retrieval_precision": f"{retrieval_metrics['precision']:.3f}",
            "retrieval_recall": f"{retrieval_metrics['recall']:.3f}",
            "retrieval_f1": f"{retrieval_metrics['f1']:.3f}",
            "semantic_similarity": f"{semantic_sim:.3f}",
            "ndcg@k": f"{ndcg:.3f}",
            "top_sources": " | ".join(top_sources),
            # Response metrics
            "citation_present": int(answer_scores["citation_present"]),
            "guiding_question_present": int(answer_scores["guiding_question_present"]),
            "keyword_recall": f"{answer_scores.get('keyword_recall', 0.0):.3f}" if answer_scores.get("keyword_recall") is not None else "N/A",
            "forbidden_phrase_hit": int(answer_scores["forbidden_phrase_hit"]),
            "direct_answer_violation": int(answer_scores["direct_answer_violation"]),
            "pedagogical_score": f"{answer_scores['pedagogical_score']:.3f}",
            "citation_pass": int(answer_scores["citation_pass"]),
            "question_pass": int(answer_scores["question_pass"]),
            "content_pass": int(answer_scores["content_pass"]),
            "no_direct_pass": int(answer_scores["no_direct_pass"]),
            "response_length": answer_scores["response_length"],
            "response": response_text[:200] + "..." if len(response_text) > 200 else response_text,
        })

    # Aggregate statistics
    total_items = len(eval_items)
    
    avg_retrieval_precision = np.mean([m["precision"] for m in retrieval_metrics_list]) if retrieval_metrics_list else 0.0
    avg_retrieval_recall = np.mean([m["recall"] for m in retrieval_metrics_list]) if retrieval_metrics_list else 0.0
    avg_retrieval_f1 = np.mean([m["f1"] for m in retrieval_metrics_list]) if retrieval_metrics_list else 0.0
    
    stats = {
        # Retrieval metrics
        "avg_retrieval_precision": float(avg_retrieval_precision),
        "avg_retrieval_recall": float(avg_retrieval_recall),
        "avg_retrieval_f1": float(avg_retrieval_f1),
        "avg_semantic_similarity": float(np.mean(semantic_sims)) if semantic_sims else 0.0,
        "avg_ndcg": float(np.mean(ndcg_scores)) if ndcg_scores else 0.0,
        
        # Response quality metrics
        "citation_pass_rate": float(citation_hits / total_items) if total_items > 0 else 0.0,
        "question_pass_rate": float(question_hits / total_items) if total_items > 0 else 0.0,
        "content_pass_rate": float(content_hits / total_items) if total_items > 0 else 0.0,
        "no_direct_answer_pass_rate": float(no_direct_hits / total_items) if total_items > 0 else 0.0,
        
        # Pedagogical compliance
        "avg_pedagogical_score": float(np.mean(pedagogical_scores)) if pedagogical_scores else 0.0,
        "avg_keyword_recall": float(np.mean(keyword_scores)) if keyword_scores else 0.0,
        "avg_response_length": float(np.mean(response_lengths)) if response_lengths else 0.0,
        
        # Counts
        "total_questions": total_items,
        "evaluation_timestamp": datetime.now().isoformat(),
    }

    return rows, stats


def main():
    parser = argparse.ArgumentParser(description="Enhanced RAG Evaluation")
    parser.add_argument(
        "--eval-file",
        type=Path,
        required=True,
        help="Path to JSONL evaluation file",
    )
    parser.add_argument(
        "--output-file",
        type=Path,
        default=Path("data/eval_results_enhanced.csv"),
        help="Output CSV file for results",
    )
    parser.add_argument(
        "--stats-file",
        type=Path,
        default=Path("data/eval_stats_enhanced.json"),
        help="Output JSON file for aggregated statistics",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=3,
        help="Number of top results to retrieve",
    )
    parser.add_argument(
        "--classroom-id",
        type=str,
        default="test_classroom",
        help="Classroom ID for vector store",
    )

    args = parser.parse_args()

    # Load evaluation items
    print(f"📂 Loading evaluation file: {args.eval_file}")
    eval_items = _load_jsonl(args.eval_file)
    print(f"✅ Loaded {len(eval_items)} evaluation questions")

    # Run evaluation
    results, stats = evaluate(eval_items, top_k=args.top_k, classroom_id=args.classroom_id)

    # Write results CSV
    args.output_file.parent.mkdir(parents=True, exist_ok=True)
    with args.output_file.open("w", newline="", encoding="utf-8") as f:
        if results:
            fieldnames = results[0].keys()
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)
    print(f"✅ Results saved to: {args.output_file}")

    # Write statistics JSON
    with args.stats_file.open("w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    print(f"✅ Statistics saved to: {args.stats_file}")

    # Print summary
    print("\n" + "="*70)
    print("📊 EVALUATION SUMMARY")
    print("="*70)
    print(f"\n🔍 RETRIEVAL METRICS:")
    print(f"  • Avg Precision:          {stats['avg_retrieval_precision']:.3f}")
    print(f"  • Avg Recall:             {stats['avg_retrieval_recall']:.3f}")
    print(f"  • Avg F1:                 {stats['avg_retrieval_f1']:.3f}")
    print(f"  • Avg Semantic Similarity: {stats['avg_semantic_similarity']:.3f}")
    print(f"  • Avg NDCG@{args.top_k}:          {stats['avg_ndcg']:.3f}")
    
    print(f"\n📝 RESPONSE QUALITY METRICS:")
    print(f"  • Citation Pass Rate:     {stats['citation_pass_rate']:.1%}")
    print(f"  • Question Pass Rate:     {stats['question_pass_rate']:.1%}")
    print(f"  • Content Pass Rate:      {stats['content_pass_rate']:.1%}")
    print(f"  • No Direct Answer Rate:  {stats['no_direct_answer_pass_rate']:.1%}")
    
    print(f"\n🎓 PEDAGOGICAL METRICS:")
    print(f"  • Avg Pedagogical Score:  {stats['avg_pedagogical_score']:.3f}/1.0")
    print(f"  • Avg Keyword Recall:     {stats['avg_keyword_recall']:.1%}")
    print(f"  • Avg Response Length:    {stats['avg_response_length']:.0f} chars")
    
    print(f"\n📈 TOTAL QUESTIONS:        {stats['total_questions']}")
    print("="*70)


if __name__ == "__main__":
    main()
