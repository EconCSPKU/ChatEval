# ChatEval 2.0

A modern engagement analysis system for conversational data.

## Project Structure

- `backend/`: FastAPI application (API, Database, Logic).
- `frontend/`: Static files (HTML, JS) served by the backend.
- `ecosystem.config.js`: PM2 configuration for deployment.
- `nginx.conf`: Nginx configuration snippet.

## Setup & Run

1.  **Install Dependencies**
    ```bash
    pip install -r backend/requirements.txt
    ```

2.  **Run Locally**
    ```bash
    cd backend
    uvicorn main:app --reload
    ```
    Access the app at `http://localhost:8000`.

3.  **Deploy (Server)**
    - Ensure Python and PM2 are installed.
    - Run `pm2 start ecosystem.config.js`.
    - Configure Nginx using `nginx.conf`.

## Features

- **Modern UI**: Dark mode, clean visualizations (Chart.js), responsive design.
- **Data Persistence**: SQLite database stores user history and feedback.
- **User System**: Cookie-less, ID-based user tracking (stored in localStorage).
- **Core Logic**: Reuses original PyTorch scoring models and Doubao/OpenAI extraction.
