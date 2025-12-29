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
        
        currentChatData = extractData.chat_data;
        currentConversationId = null; 
        
        // 2. Render Unified (No scoring yet)
        renderUnifiedChat();
        showChatView();
        
        // Ensure "Analyze" is visible, "Chart" is placeholder
        document.getElementById('analyze-btn').classList.remove('hidden');
        document.getElementById('chart-placeholder').classList.remove('hidden');
        document.getElementById('scoreChart').classList.add('hidden');
        document.getElementById('save-btn').classList.add('hidden'); // Hide manual save since we auto-save on analysis

    } catch (err) {
        alert("Error: " + err.message);
        console.error(err);
    } finally {
        setLoading(false);
    }
}

async function analyzeSession() {
    if (!currentChatData || currentChatData.length === 0) return;

    setLoading(true, "Analyzing engagement...");
    try {
        // 2. Score
        const scoreResp = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_data: currentChatData })
        });
        
        if (!scoreResp.ok) throw new Error("Scoring failed");
        const scoreData = await scoreResp.json();
        
        // 3. Update & Render
        currentChatData = scoreData.chat_data;
        renderUnifiedChat();
        renderChart(currentChatData);
        
        // UI Updates
        document.getElementById('chart-placeholder').classList.add('hidden');
        document.getElementById('scoreChart').classList.remove('hidden');
        
        // Auto-save
        await saveSession(true);
        
    } catch (err) {
        alert("Error: " + err.message);
        console.error(err);
    } finally {
        setLoading(false);
    }
}

function renderUnifiedChat() {
    chatContainer.innerHTML = '';
    let totalScore = 0;
    let scoredCount = 0;
    
    currentChatData.forEach((turn, index) => {
        const isMe = turn.speaker === 'Me' || turn.speaker === 'A' || turn.speaker.includes('Right');
        const alignClass = isMe ? 'justify-end' : 'justify-start';
        
        // Default Colors (Edit Mode style)
        let bgColor = '#27272a'; // Zinc-800
        let textColor = '#e4e4e7'; // Zinc-200
        let borderColor = '#3f3f46'; // Zinc-700
        
        // Scored Colors (Result Mode style)
        if (turn.relevance_score !== null && turn.relevance_score !== undefined) {
            totalScore += turn.relevance_score;
            scoredCount++;
            
            const score = Math.max(-5, Math.min(5, turn.relevance_score));
            const hue = ((score + 5) / 10) * 120; // 0 (Red) to 120 (Green)
            bgColor = `hsl(${hue}, 70%, 40%)`;
            textColor = '#ffffff';
            borderColor = 'transparent'; // Remove border for colored bubbles
        }
        
        const borderRadius = isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px';
        const scoreDisplay = (turn.relevance_score !== null && turn.relevance_score !== undefined)
            ? `<div class="px-3 pb-1 text-[10px] text-white/70 text-right pointer-events-none select-none">Score: ${turn.relevance_score.toFixed(1)}</div>` 
            : '';

        const html = `
            <div class="flex ${alignClass} w-full max-w-3xl mx-auto group mb-4 animate-fade-in" style="animation-delay: ${index * 0.02}s">
                 <div class="flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}">
                    
                    <!-- Controls Row (Speaker + Actions) -->
                    <div class="flex items-center gap-2 px-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}">
                         <button onclick="toggleSpeaker(${index})" class="text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity ${isMe ? 'bg-emerald-500 text-black' : 'bg-zinc-600 text-zinc-300'}">
                            ${turn.speaker}
                         </button>
                         <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-zinc-900/80 rounded px-1">
                             <button onclick="moveMessage(${index}, -1)" class="p-1 hover:text-white text-zinc-500" title="Move Up"><i class="ph-bold ph-arrow-up"></i></button>
                             <button onclick="moveMessage(${index}, 1)" class="p-1 hover:text-white text-zinc-500" title="Move Down"><i class="ph-bold ph-arrow-down"></i></button>
                             <button onclick="deleteMessage(${index})" class="p-1 hover:text-red-500 text-zinc-500" title="Delete"><i class="ph-bold ph-trash"></i></button>
                         </div>
                    </div>
                    
                    <!-- Editable Message Bubble -->
                    <div class="inline-block transition-colors duration-300" style="background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: ${borderRadius}; min-width: 60px;">
                        <textarea 
                            onchange="updateMessageText(${index}, this.value)" 
                            oninput="autoResize(this)"
                            class="bg-transparent text-sm font-sans leading-relaxed p-3 pb-1 focus:outline-none resize-none block"
                            style="color: ${textColor}; overflow-y: hidden; min-height: 40px; width: 100%;"
                            rows="1">${turn.message}</textarea>
                        ${scoreDisplay}
                    </div>
                </div>
            </div>
        `;
        chatContainer.insertAdjacentHTML('beforeend', html);
    });
    
    // Initial resize for all textareas
    requestAnimationFrame(() => {
        document.querySelectorAll('#chat-container textarea').forEach(tx => autoResize(tx));
    });
    
    // Update stats
    const avg = scoredCount > 0 ? (totalScore / scoredCount).toFixed(1) : '--';
    document.getElementById('avg-score').textContent = avg;
    document.getElementById('turn-count').textContent = currentChatData.length;
}

// Auto-resize helper function with dynamic width support
function autoResize(textarea) {
    const bubble = textarea.parentElement; // Get the bubble container
    
    // Create a hidden measurement element
    const measure = document.createElement('div');
    measure.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        font-size: 14px;
        font-family: Inter, sans-serif;
        line-height: 1.5;
        padding: 12px 12px 4px 12px;
        pointer-events: none;
    `;
    measure.textContent = textarea.value || 'A'; // Use 'A' as minimum content
    document.body.appendChild(measure);
    
    const naturalWidth = measure.offsetWidth;
    const maxWidth = 450; // Maximum width before wrapping
    const minWidth = 60; // Minimum bubble width
    
    document.body.removeChild(measure);
    
    // Determine mode based on content width
    if (naturalWidth <= maxWidth) {
        // Single-line mode: dynamic width, fixed height
        bubble.style.width = Math.max(naturalWidth, minWidth) + 'px';
        textarea.style.whiteSpace = 'nowrap';
        textarea.style.overflowX = 'hidden';
        textarea.style.height = '40px';
    } else {
        // Multi-line mode: fixed width, dynamic height
        bubble.style.width = maxWidth + 'px';
        textarea.style.whiteSpace = 'pre-wrap';
        textarea.style.overflowX = 'hidden';
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }
}

// Edit Actions
function toggleSpeaker(index) {
    const turn = currentChatData[index];
    if (turn.speaker === 'Me') turn.speaker = 'Them';
    else if (turn.speaker === 'Them') turn.speaker = 'Me';
    else turn.speaker = (index % 2 === 0) ? 'Them' : 'Me'; // Fallback
    
    // We do NOT clear score here, but it might be conceptually "stale". 
    // User can re-analyze to update.
    renderUnifiedChat();
}

function moveMessage(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= currentChatData.length) return;
    
    const temp = currentChatData[index];
    currentChatData[index] = currentChatData[newIndex];
    currentChatData[newIndex] = temp;
    
    renderUnifiedChat();
}

function deleteMessage(index) {
    currentChatData.splice(index, 1);
    renderUnifiedChat();
}

function updateMessageText(index, newText) {
    currentChatData[index].message = newText;
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
            // Relative time calculation
            const now = new Date();
            // Server returns UTC, but browser parses it as local or UTC depending on string format
            // Let's ensure we treat it as UTC by appending 'Z' if missing and using getTime()
            let dateStr = item.date;
            if (!dateStr.endsWith('Z')) dateStr += 'Z'; 
            
            const diff = (now.getTime() - new Date(dateStr).getTime()) / 1000;
            
            let timeString;
            if (diff < 60) timeString = 'Just now';
            else if (diff < 3600) timeString = `${Math.floor(diff / 60)}m ago`;
            else if (diff < 86400) timeString = `${Math.floor(diff / 3600)}h ago`;
            else timeString = new Date(dateStr).toLocaleDateString();

            const isSelected = currentConversationId === item.id;
            const bgClass = isSelected ? 'bg-zinc-800 ring-1 ring-zinc-700' : 'hover:bg-zinc-800';

            const el = document.createElement('div');
            el.className = `relative p-3 rounded-lg ${bgClass} cursor-pointer transition-colors group mb-1`;
            el.innerHTML = `
                <div class="text-sm font-medium text-zinc-300 group-hover:text-white truncate pr-6">${item.title || 'Untitled Session'}</div>
                <div class="text-xs text-zinc-500 mt-1 flex justify-between">
                    <span>${timeString}</span>
                    <span>${item.message_count} msgs</span>
                </div>
                <button onclick="deleteSession(event, ${item.id})" class="absolute top-2 right-2 text-zinc-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <i class="ph-bold ph-x"></i>
                </button>
            `;
            el.onclick = (e) => {
                // Prevent click if delete button was clicked
                if (e.target.closest('button')) return;
                loadConversation(item.id);
            };
            historyList.appendChild(el);
        });
    } catch (e) {
        console.error("Failed to load history", e);
    }
}

async function deleteSession(event, id) {
    event.stopPropagation();
    if (!confirm("Remove this session from history?")) return;
    
    try {
        const resp = await fetch(`/api/conversation/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            loadHistory();
            // If current open session is deleted, go to new session
            if (currentConversationId === id) {
                startNewSession();
            }
        } else {
            alert("Failed to delete session");
        }
    } catch (e) {
        alert("Error deleting session");
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
        
        renderUnifiedChat();
        renderChart(currentChatData);
        showChatView();
        
        // Hide/Show correct buttons
        document.getElementById('analyze-btn').classList.remove('hidden');
        document.getElementById('chart-placeholder').classList.add('hidden');
        document.getElementById('scoreChart').classList.remove('hidden');
        document.getElementById('save-btn').classList.add('hidden');

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
