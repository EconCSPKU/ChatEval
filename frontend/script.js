// State
let userId = localStorage.getItem('chateval_user_id');
if (!userId) {
    // Generate 8-char hex string (e.g., 6504b65f)
    userId = Math.random().toString(16).substr(2, 8);
    localStorage.setItem('chateval_user_id', userId);
}

let currentChatData = [];
let currentConversationId = null;
let chartInstance = null;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadView = document.getElementById('upload-view');
const chatView = document.getElementById('chat-view');
const loadingOverlay = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const chatContainer = document.getElementById('chat-container');
const userIdDisplay = document.getElementById('user-id-display');
const historyList = document.getElementById('history-list');

// Init
document.addEventListener('DOMContentLoaded', () => {
    userIdDisplay.textContent = `ID: ${userId.substring(0, 8)}`;
    loadHistory();
    
    // Drag & Drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-primary');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-primary');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-primary');
        const files = e.dataTransfer.files;
        handleFiles(files);
    });
    
    dropzone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
});

async function handleFiles(files) {
    if (files.length === 0) return;
    
    setLoading(true, "Extracting chat from images...");
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
    }
    
    try {
        // 1. Extract
        const extractResp = await fetch('/api/extract', {
            method: 'POST',
            body: formData
        });
        
        if (!extractResp.ok) throw new Error("Extraction failed");
        const extractData = await extractResp.json();
        
        // 2. Score
        setLoading(true, "Analyzing engagement...");
        const scoreResp = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_data: extractData.chat_data })
        });
        
        if (!scoreResp.ok) throw new Error("Scoring failed");
        const scoreData = await scoreResp.json();
        
        // 3. Render
        currentChatData = scoreData.chat_data;
        currentConversationId = null; // New session
        renderChat(currentChatData);
        renderChart(currentChatData);
        showChatView();
        
        // Auto-save
        await saveSession(true);
        
    } catch (err) {
        alert("Error: " + err.message);
        console.error(err);
    } finally {
        setLoading(false);
    }
}

function renderChat(data) {
    chatContainer.innerHTML = '';
    let totalScore = 0;
    let scoredCount = 0;
    
    data.forEach((turn, index) => {
        const isMe = turn.speaker === 'Me' || turn.speaker === 'A' || turn.speaker.includes('Right');
        const alignClass = isMe ? 'justify-end' : 'justify-start';
        // const bubbleClass = isMe ? 'chat-bubble-me' : 'chat-bubble-them'; // Logic replaced by dynamic color
        
        let bgColor = isMe ? '#10b981' : '#27272a'; // Default
        let textColor = '#e4e4e7';
        
        if (turn.relevance_score !== null) {
            totalScore += turn.relevance_score;
            scoredCount++;
            
            // Color based on score (-5 to 5)
            // Map -5..5 to Hue 0 (Red) .. 140 (Green)
            const score = Math.max(-5, Math.min(5, turn.relevance_score));
            const hue = ((score + 5) / 10) * 120; // 0 to 120
            bgColor = `hsl(${hue}, 70%, 40%)`;
            textColor = '#ffffff';
        }
        
        const borderRadius = isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px';
        
        const scoreDisplay = turn.relevance_score !== null 
            ? `<div class="text-[10px] opacity-70 mt-1 text-right">Score: ${turn.relevance_score.toFixed(1)}</div>` 
            : '';
            
        const html = `
            <div class="flex ${alignClass} animate-fade-in mx-auto max-w-3xl w-full" style="animation-delay: ${index * 0.05}s">
                <div class="max-w-[80%]">
                    <div class="text-[10px] text-zinc-500 mb-1 px-1 ${isMe ? 'text-right' : 'text-left'}">${turn.speaker}</div>
                    <div class="px-4 py-2 text-sm shadow-sm" style="background-color: ${bgColor}; color: ${textColor}; border-radius: ${borderRadius}">
                        ${turn.message}
                        ${scoreDisplay}
                    </div>
                </div>
            </div>
        `;
        chatContainer.insertAdjacentHTML('beforeend', html);
    });
    
    // Update stats
    const avg = scoredCount > 0 ? (totalScore / scoredCount).toFixed(1) : 0;
    document.getElementById('avg-score').textContent = avg;
    document.getElementById('turn-count').textContent = data.length;
}

function renderChart(data) {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    const labels = data.map((_, i) => i + 1);
    
    // Split data
    const meData = data.map(d => {
        const isMe = d.speaker === 'Me' || d.speaker === 'A' || d.speaker.includes('Right');
        return isMe ? d.relevance_score : null;
    });
    
    const themData = data.map(d => {
        const isMe = d.speaker === 'Me' || d.speaker === 'A' || d.speaker.includes('Right');
        return !isMe ? d.relevance_score : null;
    });

    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Me',
                    data: meData,
                    borderColor: '#10b981', // Emerald
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    spanGaps: true,
                    pointRadius: 3
                },
                {
                    label: 'Them',
                    data: themData,
                    borderColor: '#a1a1aa', // Zinc-400
                    backgroundColor: 'rgba(161, 161, 170, 0.1)',
                    tension: 0.4,
                    spanGaps: true,
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    min: -5,
                    max: 5,
                    grid: { color: '#27272a' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { 
                    display: true,
                    labels: { color: '#e4e4e7' }
                }
            }
        }
    });
}

async function saveSession(silent = false) {
    if (!currentChatData.length) return;
    
    const btn = document.getElementById('save-btn'); // Note: This button is hidden now
    
    try {
        const resp = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                chat_data: currentChatData
            })
        });
        
        const data = await resp.json();
        if (data.success) {
            currentConversationId = data.conversation_id;
            loadHistory();
            
            if (data.title) {
                document.getElementById('session-title').textContent = data.title;
            }
            
            if (!silent) alert("Session saved!");
        }
    } catch (e) {
        if (!silent) alert("Failed to save: " + e.message);
    }
}

async function loadHistory() {
    try {
        const resp = await fetch(`/api/history/${userId}`);
        const data = await resp.json();
        
        historyList.innerHTML = '';
        data.forEach(item => {
            const date = new Date(item.date).toLocaleDateString();
            const el = document.createElement('div');
            el.className = 'p-3 rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors group';
            el.innerHTML = `
                <div class="text-sm font-medium text-zinc-300 group-hover:text-white truncate">${item.title || 'Untitled Session'}</div>
                <div class="text-xs text-zinc-500 mt-1 flex justify-between">
                    <span>${date}</span>
                    <span>${item.message_count} msgs</span>
                </div>
            `;
            el.onclick = () => loadConversation(item.id);
            historyList.appendChild(el);
        });
    } catch (e) {
        console.error("Failed to load history", e);
    }
}

async function loadConversation(id) {
    setLoading(true, "Loading session...");
    try {
        const resp = await fetch(`/api/conversation/${id}`);
        const data = await resp.json();
        
        currentChatData = data.messages;
        currentConversationId = data.id;
        
        if (data.title) {
            document.getElementById('session-title').textContent = data.title;
        }
        
        renderChat(currentChatData);
        renderChart(currentChatData);
        showChatView();
        
    } catch (e) {
        alert("Error loading conversation");
    } finally {
        setLoading(false);
    }
}

// UI Helpers
function setLoading(show, text) {
    if (show) {
        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = text;
    } else {
        loadingOverlay.classList.add('hidden');
    }
}

function showChatView() {
    uploadView.classList.add('hidden');
    chatView.classList.remove('hidden');
}

function startNewSession() {
    chatView.classList.add('hidden');
    uploadView.classList.remove('hidden');
    currentChatData = [];
    currentConversationId = null;
    fileInput.value = ''; // Reset input
    document.getElementById('session-title').textContent = "New Session";
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('hidden');
}

// Feedback
let feedbackRating = 0;
document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('bg-primary', 'text-white'));
        btn.classList.add('bg-primary', 'text-white');
        feedbackRating = parseInt(btn.dataset.val);
    });
});

function submitFeedback() {
    if (!currentConversationId) {
        alert("Please save the session first before providing feedback.");
        return;
    }
    document.getElementById('feedback-modal').classList.remove('hidden');
}

function closeFeedback() {
    document.getElementById('feedback-modal').classList.add('hidden');
}

async function sendFeedback() {
    const comment = document.getElementById('feedback-comment').value;
    if (!feedbackRating) {
        alert("Please select a rating.");
        return;
    }
    
    try {
        await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: currentConversationId,
                rating: feedbackRating,
                comment: comment
            })
        });
        closeFeedback();
        alert("Feedback submitted. Thank you!");
    } catch (e) {
        alert("Failed to submit feedback.");
    }
}
