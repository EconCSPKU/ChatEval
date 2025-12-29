module.exports = {
  apps: [
    {
      name: "chateval-backend",
      script: "uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000",
      cwd: "./backend",
      interpreter: "python", // Or path to venv python
      env: {
        VOLC_API_KEY: "your_key_here",
        VOLC_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3"
      }
    }
  ]
};
