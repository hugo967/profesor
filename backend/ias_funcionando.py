import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv(override=True)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Pedir la lista de modelos disponibles para esta key
models = client.models.list()

for model in models.data:
    print(f"- {model.id}")