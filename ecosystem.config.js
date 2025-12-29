module.exports = {
  apps: [{
    name: "chateval",
    script: "python3",
    args: "-m uvicorn backend.main:app --host 127.0.0.1 --port 8001",
    interpreter: "none"
  }]
}