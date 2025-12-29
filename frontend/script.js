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

    // Handle resize to adjust bubble widths
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            document.querySelectorAll('#chat-container textarea').forEach(tx => autoResize(tx));
        }, 100);
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
        
        // Auto-switch to analysis tab on mobile
        if (window.innerWidth < 1024) {
            switchTab('analysis');
        }
        
    } catch (err) {
        alert("Error: " + err.message);
        console.error(err);
    } finally {
        setLoading(false);
    }
}

function renderUnifiedChat(focusIndex = -1) {
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
                             <button onclick="addMessage(${index + 1})" class="p-1 hover:text-emerald-400 text-zinc-500" title="Add Message Below"><i class="ph-bold ph-plus"></i></button>
                             <button onclick="deleteMessage(${index})" class="p-1 hover:text-red-500 text-zinc-500" title="Delete"><i class="ph-bold ph-trash"></i></button>
                         </div>
                    </div>
                    
                    <!-- Editable Message Bubble -->
                    <div class="inline-block transition-colors duration-300 max-w-full break-words" style="background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: ${borderRadius}; min-width: 60px;">
                        <textarea 
                            onchange="updateMessageText(${index}, this.value)" 
                            oninput="autoResize(this)"
                            class="bg-transparent text-sm font-sans leading-relaxed p-3 pb-1 focus:outline-none resize-none block break-words"
                            style="color: ${textColor}; overflow-y: hidden; min-height: 40px; width: 100%;"
                            rows="1">${turn.message}</textarea>
                        ${scoreDisplay}
                    </div>
                </div>
            </div>
        `;
        chatContainer.insertAdjacentHTML('beforeend', html);
    });
    
    // Focus handling
    if (focusIndex !== -1) {
        const textareas = chatContainer.querySelectorAll('textarea');
        if (textareas[focusIndex]) {
            // Need a slight delay or just direct focus? Direct usually works if DOM is ready.
            // But we just insertedHTML.
            textareas[focusIndex].focus();
        }
    }
    
    // Initial resize for all textareas
    requestAnimationFrame(() => {
        document.querySelectorAll('#chat-container textarea').forEach(tx => autoResize(tx));
    });
    
    // Update stats
    const avg = scoredCount > 0 ? (totalScore / scoredCount).toFixed(1) : '--';
    document.getElementById('avg-score').textContent = avg;
    document.getElementById('turn-count').textContent = currentChatData.length;
}

function autoResize(textarea) {
    const bubble = textarea.parentElement;
    const styles = window.getComputedStyle(textarea);
    
    const containerPadding = 60; 
    const maxWidth = Math.min(450, window.innerWidth - containerPadding);

    const measure = document.createElement('div');
    measure.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre-wrap;
        word-break: break-word; /* 确保长单词换行 */
        overflow-wrap: break-word; /* 兼容性增强 */
        display: inline-block;
        border: ${styles.border};
        box-sizing: border-box;
        font-family: ${styles.fontFamily};
        font-size: ${styles.fontSize};
        font-weight: ${styles.fontWeight};
        letter-spacing: ${styles.letterSpacing};
        line-height: ${styles.lineHeight};
        padding: ${styles.paddingTop} ${styles.paddingRight} ${styles.paddingBottom} ${styles.paddingLeft};
        max-width: ${maxWidth}px;
    `;
    
    measure.textContent = textarea.value + (textarea.value.endsWith('\n') ? '\u200b' : '');
    document.body.appendChild(measure);
    
    const rect = measure.getBoundingClientRect();
    const naturalWidth = rect.width;
    const naturalHeight = rect.height;
    
    document.body.removeChild(measure);
    
    const minWidth = 60; 
    const finalWidth = Math.min(Math.ceil(naturalWidth) + 5, maxWidth);
    
    bubble.style.width = Math.max(finalWidth, minWidth) + 'px';
    textarea.style.height = Math.ceil(naturalHeight) + 'px';
    
    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.overflowX = 'hidden';
}

function addMessage(index) {
    let newSpeaker = 'Me';
    
    // Auto-switch speaker based on the previous message to facilitate dialogue flow
    if (index > 0) {
        const prevTurn = currentChatData[index - 1];
        if (prevTurn) {
            // If previous was 'Me', next should be 'Them', and vice versa.
            if (prevTurn.speaker === 'Me') newSpeaker = 'Them';
            else if (prevTurn.speaker === 'Them') newSpeaker = 'Me';
        }
    }

    const newMessage = {
        speaker: newSpeaker,
        message: '',
        relevance_score: null
    };
    currentChatData.splice(index, 0, newMessage);
    renderUnifiedChat(index);
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
        
        // Group by title
        const groups = {};
        data.forEach(item => {
            const t = item.title || 'Untitled Session';
            if (!groups[t]) groups[t] = [];
            groups[t].push(item);
        });

        // Sort groups by latest date of items inside
        const sortedTitles = Object.keys(groups).sort((a, b) => {
            const dateA = new Date(groups[a][0].date).getTime();
            const dateB = new Date(groups[b][0].date).getTime();
            return dateB - dateA;
        });

        sortedTitles.forEach(title => {
            const items = groups[title];
            // Verify items are sorted by date desc (API does this, but good to be sure if we modified it)
            // items.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Container
            const groupDiv = document.createElement('div');
            groupDiv.className = 'mb-1';
            
            // Header
            const header = document.createElement('div');
            header.className = 'p-3 rounded-lg hover:bg-zinc-800 cursor-pointer flex justify-between items-center group transition-colors select-none';
            header.innerHTML = `
                <div class="font-medium text-zinc-300 group-hover:text-white truncate flex-1 pr-2">${title}</div>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-zinc-500 bg-zinc-900/50 px-1.5 py-0.5 rounded">${items.length}</span>
                    <i class="ph-bold ph-caret-right text-zinc-500 transform transition-transform duration-200"></i>
                </div>
            `;
            
            // Sub-list
            const listContainer = document.createElement('div');
            listContainer.className = 'hidden ml-3 pl-2 border-l border-zinc-700/50 mt-1 space-y-1';
            
            let hasSelected = false;

            items.forEach(item => {
                // Time calc
                let dateStr = item.date;
                if (!dateStr.endsWith('Z')) dateStr += 'Z'; 
                const diff = (new Date().getTime() - new Date(dateStr).getTime()) / 1000;
                let timeString;
                if (diff < 60) timeString = 'Just now';
                else if (diff < 3600) timeString = `${Math.floor(diff / 60)}m ago`;
                else if (diff < 86400) timeString = `${Math.floor(diff / 3600)}h ago`;
                else timeString = new Date(dateStr).toLocaleDateString();

                const isSelected = currentConversationId === item.id;
                if (isSelected) hasSelected = true;
                
                const bgClass = isSelected ? 'bg-zinc-800 text-white ring-1 ring-zinc-700' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';

                const itemEl = document.createElement('div');
                itemEl.className = `relative p-2 rounded text-sm cursor-pointer transition-all ${bgClass} group/item`;
                itemEl.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span>${timeString}</span>
                        <span class="text-xs opacity-50">${item.message_count} msgs</span>
                    </div>
                    <button onclick="deleteSession(event, ${item.id})" class="absolute top-1/2 -translate-y-1/2 right-1 p-1 text-zinc-500 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <i class="ph-bold ph-x text-xs"></i>
                    </button>
                `;
                
                itemEl.onclick = (e) => {
                    if (e.target.closest('button')) return;
                    loadConversation(item.id);
                };
                
                listContainer.appendChild(itemEl);
            });

            // Toggle Logic
            header.onclick = () => {
                const isHidden = listContainer.classList.contains('hidden');
                const icon = header.querySelector('i.ph-caret-right');
                
                if (isHidden) {
                    listContainer.classList.remove('hidden');
                    icon.style.transform = 'rotate(90deg)';
                } else {
                    listContainer.classList.add('hidden');
                    icon.style.transform = 'rotate(0deg)';
                }
            };

            // Auto-expand if selected
            if (hasSelected) {
                listContainer.classList.remove('hidden');
                header.querySelector('i.ph-caret-right').style.transform = 'rotate(90deg)';
            }

            groupDiv.appendChild(header);
            groupDiv.appendChild(listContainer);
            historyList.appendChild(groupDiv);
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
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar.classList.contains('hidden')) {
            sidebar.classList.add('hidden');
        }
    }
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

        // Refresh history to update highlighting
        loadHistory();

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
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
    setTimeout(() => {
        document.querySelectorAll('#chat-container textarea').forEach(tx => autoResize(tx));
    }, 100);
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

function switchTab(tab) {
    const chatCol = document.getElementById('mobile-chat-col');
    const analysisCol = document.getElementById('mobile-analysis-col');
    const tabChat = document.getElementById('tab-btn-chat');
    const tabAnalysis = document.getElementById('tab-btn-analysis');

    if (tab === 'chat') {
        chatCol.classList.remove('hidden');
        analysisCol.classList.add('hidden');
        analysisCol.classList.remove('flex');
        
        tabChat.classList.add('text-white', 'border-primary');
        tabChat.classList.remove('text-zinc-400', 'border-transparent');
        
        tabAnalysis.classList.remove('text-white', 'border-primary');
        tabAnalysis.classList.add('text-zinc-400', 'border-transparent');
    } else {
        chatCol.classList.add('hidden');
        analysisCol.classList.remove('hidden');
        analysisCol.classList.add('flex');
        
        tabAnalysis.classList.add('text-white', 'border-primary');
        tabAnalysis.classList.remove('text-zinc-400', 'border-transparent');
        
        tabChat.classList.remove('text-white', 'border-primary');
        tabChat.classList.add('text-zinc-400', 'border-transparent');
    }
}
