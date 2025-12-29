module.exports = {
  apps: [{
    name: "chateval",
    script: "python3",
    cwd: "./backend",
    args: "-m uvicorn server.main:app --host 127.0.0.1 --port 8000",
    interpreter: "none"
  }]
}