import sys
import os
# Update the import to use the Hybrid Parent Retriever
from src.retriever import HybridParentRetriever 
from src.main import socratic_agent  # Use the agentic loop instead of simple chat
from src.config import LLM_MODEL, OLLAMA_HOST

def main():
    print("--- 🧑‍🏫 AI College Tutor: Socratic RAG System ---")
    chat_history = []
    
    # Initialize the Hybrid Retriever which builds BM25 and Vector indices
    try:
        # Use the class name updated in your retriever.py
        retriever = HybridParentRetriever()
        print("✅ Hybrid Vector & Keyword Database Connected.")
    except Exception as e:
        print(f"❌ Error connecting to Vector DB: {e}")
        print("Ensure you have ingested PDFs using 'python -m src.ingest'")
        sys.exit(1)

    print(f"Using Model: {LLM_MODEL} at {OLLAMA_HOST}")
    print("Type 'exit' or 'quit' to stop the session.\n")

    while True:
        try:
            user_query = input("Student: ").strip()
            
            if user_query.lower() in ['exit', 'quit']:
                print("Goodbye! Happy learning.")
                break
            
            if not user_query:
                continue

            # Trigger the Socratic Agent
            # This handles Query Routing, Retrieval, and Socratic Scaffolding
            response = socratic_agent(user_query, retriever, history=chat_history)
            chat_history.append({"role": "student", "content": user_query})
            chat_history.append({"role": "tutor", "content": response})

            # Keep memory bounded while preserving the latest conversational context.
            if len(chat_history) > 24:
                chat_history = chat_history[-24:]
            
            print(f"\nTutor: {response}\n")
            print("-" * 50)

        except KeyboardInterrupt:
            print("\nSession ended by user.")
            break
        except Exception as e:
            print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    main()


