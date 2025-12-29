# ChatEval 2.0

A modern engagement analysis system for conversational data.

## Project Structure

- `backend/`: FastAPI application (API, Database, Logic).
- `frontend/`: Static files (HTML, JS) serving the modern UI.
- `ecosystem.config.js`: PM2 configuration for process management.
- `nginx.conf`: Nginx configuration template for production.

## New Features

- **Dynamic Dialogue Management**: 
  - History is now grouped by session title for cleaner navigation.
  - Expandable/collapsible session groups with latest activity sorting.
- **Enhanced Editing Experience**: 
  - **Dynamic Bubbles**: Message bubbles auto-resize in width and height based on content.
  - **Quick Add**: Insert new messages anywhere in the conversation with a single click (`+` button).
  - **Smart Speaker Switching**: Automatically toggles between "Me" and "Them" when adding new messages.
- **Visual Analytics**: 
  - Real-time engagement scoring visualization.
  - Color-coded message relevance (Heatmap style).

## Setup & Run (Local)

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

## Deployment Guide (Server)

This guide assumes you are deploying on a Linux server (Ubuntu/Debian) with `pm2` and `nginx`.

### 1. Prerequisites
- Python 3.8+
- Node.js & npm (for pm2)
- Nginx

```bash
# Install system dependencies
sudo apt update
sudo apt install python3-pip python3-venv nginx nodejs npm

# Install PM2 globally
sudo npm install -g pm2
```

### 2. Application Setup
Clone the repository and set up the python environment.

```bash
# Clone repo
git clone https://github.com/your-repo/ChatEval.git
cd ChatEval

# Setup Python Virtual Environment (Recommended)
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

### 3. Start Backend with PM2
Use the provided `ecosystem.config.js` to manage the FastAPI process.

```bash
# Start the application
pm2 start ecosystem.config.js

# Save process list for auto-restart on reboot
pm2 save
pm2 startup
```
*Note: The ecosystem file expects to run `python3`. If you use a venv, you may need to update the `interpreter` path in `ecosystem.config.js` to `./venv/bin/python`.*

### 4. Configure Nginx
Use `nginx.conf` as a template to serve the frontend and proxy API requests.

1.  Copy the config:
    ```bash
    sudo cp nginx.conf /etc/nginx/sites-available/chateval
    ```

2.  **Edit the config** (`/etc/nginx/sites-available/chateval`):
    - Update `server_name` to your domain or IP.
    - Update `root` path in `location /` to the absolute path of your `ChatEval/frontend` directory (e.g., `/home/user/ChatEval/frontend`).

3.  Enable the site and restart Nginx:
    ```bash
    sudo ln -s /etc/nginx/sites-available/chateval /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    ```

### 5. Verify
- Visit `http://your-domain` to see the UI.
- The API is available at `http://your-domain/api`.
