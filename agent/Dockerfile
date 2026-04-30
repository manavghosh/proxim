FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

RUN pip install poetry

COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false && poetry install --no-dev --no-interaction

RUN playwright install chromium

COPY agent/ ./agent/

CMD ["python", "-m", "agent.daemon"]
