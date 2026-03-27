# ⚡ QUICK START: RAG Evaluation

## 🚀 Run Evaluation in 3 Steps

### Step 1: Ensure Ollama is Running
```bash
ollama serve
# Keep this terminal open in background
```

### Step 2: Run Evaluation Pipeline (PowerShell)
```powershell
cd c:\AI_TUTOR
$env:PYTHONPATH='.'

# Run all at once
python -m python run_eval_enhanced.py --eval-file data/eval_set_generated.jsonl --classroom-id test_classroom --top-k 3
```

### Step 3: Check Results
```powershell
# View summary stats
Get-Content data/eval_stats_enhanced.json | ConvertFrom-Json

# View detailed results
Import-Csv data/eval_results_enhanced.csv | Select-Object -First 5
```

---

## 📊 What You Get

### **CSV Results** (`eval_results_enhanced.csv`)
Per-question breakdown:
- Question ID & text
- Retrieval precision/recall/F1
- Semantic similarity score
- Citation presence
- Guiding question presence
- Full response text

### **JSON Stats** (`eval_stats_enhanced.json`)
Aggregate metrics:
```json
{
  "avg_retrieval_precision": 0.857,
  "avg_retrieval_recall": 0.923,
  "citation_pass_rate": 0.952,
  "avg_semantic_similarity": 0.756,
  "avg_pedagogical_score": 0.903,
  "total_questions": 21
}
```

---

## 🎯 Key Metrics at a Glance

| Metric | Target | Good | Poor |
|--------|--------|------|------|
| **Retrieval Precision** | > 0.85 | ✅ 0.90+ | ❌ < 0.60 |
| **Retrieval Recall** | > 0.80 | ✅ 0.95+ | ❌ < 0.50 |
| **Citation Rate** | > 0.90 | ✅ 0.95+ | ❌ < 0.70 |
| **Question Rate** | > 0.85 | ✅ 0.90+ | ❌ < 0.70 |
| **Pedagogical Score** | > 0.85 | ✅ 0.90+ | ❌ < 0.70 |
| **Semantic Similarity** | > 0.70 | ✅ 0.80+ | ❌ < 0.50 |

---

## 📁 Test Data Status

✅ **7 PDFs Ingested**:
- Arrays.pdf
- Stack.pdf
- Queue.pdf
- Linked List.pdf
- Trees.pdf
- Dynamic Programming.pdf
- Asymptotic Analysis.pdf

✅ **21 Questions Generated**:
- 3 questions per PDF topic
- Covers: concepts, applications, Socratic problem-solving

✅ **Ready to Evaluate**:
- Vector store: `test_classroom`
- Questions file: `data/eval_set_generated.jsonl`

---

## 🔍 Troubleshooting

| Issue | Fix |
|-------|-----|
| "Connection refused localhost:11434" | Start Ollama: `ollama serve` |
| No retrieval results | Run: `python ingest_test_data.py` |
| Slow (5-10 min) | Normal for 21 questions with LLM |
| "No such file" | Ensure `data/eval_set_generated.jsonl` exists |

---

## 📚 Examples

### Get Top 5 Worst Performing Questions
```powershell
$csv = Import-Csv data/eval_results_enhanced.csv
$csv | Sort-Object {[float]$_.pedagogical_score} | Select-Object -First 5 | Format-Table question, pedagogical_score
```

### Calculate Avg Metrics
```powershell
$csv = Import-Csv data/eval_results_enhanced.csv
$csv | Measure-Object @{e={[float]$_.retrieval_precision}} -Average
```

### Export Beautiful Report
```powershell
$stats = Get-Content data/eval_stats_enhanced.json | ConvertFrom-Json
$stats | ConvertTo-Json | Out-File eval_report.json
```

---

## 🎓 All Evaluation Scripts

| Script | Purpose |
|--------|---------|
| `run_eval_enhanced.py` | Core evaluation engine with all metrics |
| `generate_eval_questions.py` | Auto-generate questions from PDFs |
| `ingest_test_data.py` | Load PDFs into vector store |

---

**Framework Status**: ✅ Ready to evaluate
**Test Data**: ✅ Ingested (7 PDFs)
**Questions**: ✅ Generated (21 questions)
**Metrics**: ✅ Full suite implemented

👉 **Next**: Start Ollama and run evaluation!
