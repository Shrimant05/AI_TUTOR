# 🎓 AI TUTOR - RAG EVALUATION FRAMEWORK

## Overview
Comprehensive evaluation suite for testing RAG pipeline quality using advanced metrics.

---

## ✅ What's Been Set Up

### 1. **Test Data** ✓
- **Location**: `test_data/` folder
- **Files ingested** (7 PDFs):
  - Arrays.pdf
  - Stack.pdf
  - Queue.pdf
  - Linked List.pdf
  - Trees.pdf
  - Dynamic Programming.pdf
  - Asymptotic Analysis.pdf
- **Status**: Already ingested into `test_classroom` vector store

### 2. **Evaluation Questions** ✓
- **Location**: `data/eval_set_generated.jsonl`
- **Total Questions**: 21 (3 per PDF topic)
- **Question Types**:
  - Concept explanation
  - Practical applications
  - Real-world problem solving (Socratic style)
- **Status**: Auto-generated from test PDFs

### 3. **Evaluation Scripts** ✓

#### a. **Enhanced Evaluation (`run_eval_enhanced.py`)**
Comprehensive metrics framework with:
- ✅ Retrieval Metrics (Precision, Recall, F1, NDCG)
- ✅ Semantic Similarity Scoring
- ✅ Citation Faithfulness Checks
- ✅ Pedagogical Compliance (Guiding Questions, No Direct Answers)
- ✅ Keyword Recall & Content Validation
- ✅ Multi-dimensional reporting

#### b. **Question Generator (`generate_eval_questions.py`)**
Auto-generates JSONL evaluation data from any PDFs

#### c. **Data Ingester (`ingest_test_data.py`)**
Ingests PDFs into vector store for any classroom

---

## 📊 Evaluation Metrics

### **Retrieval Tier**
| Metric | What It Measures | Why It Matters |
|--------|------------------|----------------|
| **Precision@K** | % of top-K results relevant | Avoids irrelevant retrievals |
| **Recall@K** | % of relevant docs found | Ensures all sources retrieved |
| **F1 Score** | Harmonic mean of P & R | Balanced metric |
| **Semantic Similarity** | Cosine similarity (query ↔ chunks) | Validates semantic relevance |
| **NDCG@K** | Normalized ranking quality | Rewards top-ranked relevance |

### **Response Quality Tier**
| Metric | What It Measures | Range |
|--------|------------------|-------|
| **Citation Pass Rate** | Responses cite sources | 0-100% |
| **Question Pass Rate** | Responses contain guiding questions | 0-100% |
| **Content Pass Rate** | Responses avoid forbidden phrases | 0-100% |
| **No Direct Answer Rate** | Responses don't give direct answers | 0-100% |

### **Pedagogical Tier**
| Metric | What It Measures | Range |
|--------|------------------|-------|
| **Pedagogical Score** | Overall Socratic compliance | 0.0-1.0 |
| **Keyword Recall** | % of expected concepts covered | 0.0-1.0 |
| **Response Length** | Answer comprehensiveness | # chars |

---

## 🚀 How to Run Evaluation

### **Prerequisites**
1. Ollama must be running with `llama3.1:8b` model
2. Backend & Frontend servers optional (evaluation uses local components)
3. Test PDFs in `test_data/` folder
4. Python venv activated

### **Step 1: Start Ollama** (if not running)
```bash
ollama pull llama3.1:8b    # First time only
ollama serve               # Keep running in separate terminal
```

### **Step 2: Run Full Evaluation Pipeline**
```bash
# All steps at once (recommended)
cd c:\AI_TUTOR

# a) Ingest test data (one-time)
python ingest_test_data.py

# b) Generate evaluation questions (one-time)
python generate_eval_questions.py

# c) Run enhanced evaluation
set PYTHONPATH=.
python -m python run_eval_enhanced.py ^
    --eval-file data/eval_set_generated.jsonl ^
    --classroom-id test_classroom ^
    --top-k 3
```

### **Step 3: View Results**
Results will be saved to:
- **CSV Results**: `data/eval_results_enhanced.csv` (detailed per-question)
- **JSON Stats**: `data/eval_stats_enhanced.json` (aggregate metrics)

---

## 📈 Example Output

```
======================================================================
📊 EVALUATION SUMMARY
======================================================================

🔍 RETRIEVAL METRICS:
  • Avg Precision:           0.857
  • Avg Recall:              0.923
  • Avg F1:                  0.889
  • Avg Semantic Similarity: 0.756
  • Avg NDCG@3:              0.898

📝 RESPONSE QUALITY METRICS:
  • Citation Pass Rate:      95.2%
  • Question Pass Rate:      88.6%
  • Content Pass Rate:       91.4%
  • No Direct Answer Rate:   85.7%

🎓 PEDAGOGICAL METRICS:
  • Avg Pedagogical Score:   0.903/1.0
  • Avg Keyword Recall:      78.5%
  • Avg Response Length:     245 chars

📈 TOTAL QUESTIONS:        21
======================================================================
```

---

## 🔄 Evaluation Architecture

```
Test PDFs (test_data/)
       ↓
   [Ingester]
       ↓
  Vector Store (Chroma DB)
       ↓
   [Retriever]
       ↓
Query → HybridRetriever (BM25 + Semantic)
         ↓
    Retrieved Chunks
         ↓
   [Evaluator]
    ├─ Retrieval Metrics
    ├─ Semantic Similarity
    ├─ Citation Check
    └─ Pedagogical Validation
         ↓
Results CSV + JSON Report
```

---

## 🎯 Key Features

### **Retrieval Validation**
- Checks if top-K results match gold standard sources
- Calculates precision, recall, F1 per question
- Computes NDCG for ranking quality

### **Semantic Quality**
- Uses `all-MiniLM-L6-v2` embeddings
- Cosine similarity between query & retrieved chunks
- Scores 0.0-1.0 (higher = more relevant)

### **Socratic Compliance**
- ✅ Citations required (grounding)
- ✅ Guiding questions required (pedagogy)
- ✅ Forbidden direct answers (scaffolding)
- ✅ Keyword coverage (content validation)

### **Extensibility**
- Add custom questions to `data/eval_set_generated.jsonl`
- Use `--top-k` parameter to test different retrieval depths
- Use `--classroom-id` to evaluate different data sets

---

## 📝 Custom Evaluation Questions

To add your own questions, edit `data/eval_set_generated.jsonl`:

```json
{
  "id": "custom_q1",
  "question": "Your question here?",
  "expected_keywords": ["keyword1", "keyword2"],
  "gold_sources": ["Source filename"],
  "gold_pages": [1, 2],
  "requires_citation": true,
  "requires_question": true,
  "no_direct_answer": true,
  "forbid_phrases": ["the answer is", "final answer"]
}
```

---

## 🐛 Troubleshooting

### **"Connection refused" on port 11434**
→ Ollama not running. Start it: `ollama serve`

### **"No retrieval results"**
→ Test PDFs not ingested. Run: `python ingest_test_data.py`

### **"Invalid JSON on line X"**
→ Malformed JSONL. Check `data/eval_set_generated.jsonl` formatting

### **Slow evaluation**
→ Normal for 21 questions with LLM inference. First run takes ~5-10 mins

---

## 📊 Metrics Interpretation

### **Good Performance**: 
- Precision > 0.80 (relevant results)
- Citation Rate > 90% (grounded answers)
- Pedagogical Score > 0.85 (Socratic compliance)

### **Needs Improvement**:
- Recall < 0.70 (missing relevant sources)
- Question Rate < 75% (insufficient guiding)
- Direct Answer Violations > 10% (too explicit)

---

## 🔗 Files Generated

```
c:\AI_TUTOR\
├── run_eval_enhanced.py           ← Main evaluation script
├── generate_eval_questions.py     ← Question auto-generator
├── ingest_test_data.py            ← PDF ingester
├── test_data/                     ← Test PDFs
│   ├── Arrays.pdf
│   ├── Stack.pdf
│   └── ... (7 total)
└── data/
    ├── eval_set_generated.jsonl   ← 21 evaluation questions
    ├── eval_results_enhanced.csv  ← Per-question results
    └── eval_stats_enhanced.json   ← Aggregate stats
```

---

## 🎓 Next Steps

1. **Start Ollama**: `ollama serve`
2. **Run Ingestion**: `python ingest_test_data.py`
3. **Run Evaluation**: `python run_eval_enhanced.py --eval-file data/eval_set_generated.jsonl --classroom-id test_classroom`
4. **View Results**: Check CSV and JSON outputs
5. **Iterate**: Adjust prompts, chunk sizes, or retrieval parameters based on results

---

**Evaluation Framework**: Ready for production testing ✅
