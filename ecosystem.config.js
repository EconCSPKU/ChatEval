module.exports = {
  apps: [{
    name: "chateval",
    cwd: "/var/www/ChatEval/backend",
    script: "./chateval/bin/python",
    cwd: __dirname,
    args: "-m uvicorn main:app --host 127.0.0.1 --port 8001",
    interpreter: "none"
  }]
}