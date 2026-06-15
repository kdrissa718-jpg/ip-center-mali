// Contact messaging using localStorage (client-side)
const STORAGE_KEY = 'ipcenter_messages';

function loadMessages(){
    try{
        const s = localStorage.getItem(STORAGE_KEY);
        return s? JSON.parse(s):[];
    }catch(e){return []}
}

function saveMessages(arr){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function renderMessages(){
    const list = document.getElementById('messages');
    list.innerHTML = '';
    const msgs = loadMessages();
    msgs.forEach(m=>{
        const div = document.createElement('div');
        div.className = 'bubble ' + (m.sender==='user'? 'user':'admin');
        if(m.type==='text'){
            div.innerHTML = `<div>${escapeHtml(m.content)}</div><div class="meta">${new Date(m.time).toLocaleString('fr-FR')}</div>`;
        }
        else if(m.type==='audio'){
            div.innerHTML = `<audio controls src="${m.content}"></audio><div class="meta">${new Date(m.time).toLocaleString('fr-FR')}</div>`;
        }
        list.appendChild(div);
    });
    // Auto-scroll to bottom
    setTimeout(()=>{
        list.scrollTop = list.scrollHeight;
    }, 0);
}

function escapeHtml(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sendText(){
    const ta = document.getElementById('messageText');
    const v = ta.value.trim();
    if(!v) return;
    
    const msgs = loadMessages();
    msgs.push({
        id:Date.now(),
        sender:'user',
        type:'text',
        content:v,
        time:Date.now()
    });
    saveMessages(msgs);
    renderMessages();
    ta.value='';
    ta.focus();
    
    simulateAdminReply(v);
}

function simulateAdminReply(userText){
    setTimeout(()=>{
        const msgs = loadMessages();
        const replies = [
            'Merci pour votre message. Nous vous répondrons sous peu.',
            'Votre demande a bien été reçue. Notre équipe s\'en charge.',
            'Merci de nous avoir contactés. Un agent vous répondra bientôt.',
            'Nous avons noté votre message. Cordialement!'
        ];
        const randomReply = replies[Math.floor(Math.random() * replies.length)];
        
        msgs.push({
            id:Date.now(),
            sender:'admin',
            type:'text',
            content:randomReply,
            time:Date.now()
        });
        saveMessages(msgs);
        renderMessages();
    }, 1200 + Math.random()*2000);
}

// AUDIO upload
function handleAudioFile(file){
    const reader = new FileReader();
    reader.onload = function(e){
        const data = e.target.result;
        const msgs = loadMessages();
        msgs.push({
            id:Date.now(),
            sender:'user',
            type:'audio',
            content:data,
            time:Date.now()
        });
        saveMessages(msgs);
        renderMessages();
        simulateAdminReply('[message audio reçu]');
    };
    reader.readAsDataURL(file);
}

// Recording
let mediaRecorder, recordedChunks=[];
async function startRecording(btn){
    if(!navigator.mediaDevices){
        alert('Enregistrement non supporté sur votre navigateur.');
        return;
    }
    try{
        const stream = await navigator.mediaDevices.getUserMedia({audio:true});
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = e=>{
            if(e.data.size>0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = ()=>{
            const blob = new Blob(recordedChunks,{type:'audio/webm'});
            handleAudioFile(blob);
            btn.classList.remove('recording');
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        btn.classList.add('recording');
    }catch(err){
        console.error('Erreur accès microphone:', err);
        alert('Impossible d\'accéder au microphone.');
    }
}

function stopRecording(){
    if(mediaRecorder && mediaRecorder.state!=='inactive'){
        mediaRecorder.stop();
    }
}

// Form submission
function handleFormSubmit(e){
    e.preventDefault();
    const form = e.target;
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const subject = document.getElementById('subject').value;
    const message = document.getElementById('message').value.trim();
    
    if(!name || !email || !subject || !message) return;
    
    // Store in localStorage
    const msgs = loadMessages();
    msgs.push({
        id:Date.now(),
        sender:'user',
        type:'text',
        content:`📋 Formulaire de contact\nNom: ${name}\nEmail: ${email}\nSujet: ${subject}\n\nMessage:\n${message}`,
        time:Date.now()
    });
    saveMessages(msgs);
    renderMessages();
    
    // Clear form
    form.reset();
    
    // Show success message
    const btn = form.querySelector('.btn-submit');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Envoyé!';
    btn.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';
    
    setTimeout(()=>{
        btn.innerHTML = originalText;
        btn.style.background = '';
    }, 3000);
    
    simulateAdminReply(`Merci ${name}, nous avons bien reçu votre demande.`);
}

// Initialize
window.addEventListener('DOMContentLoaded', ()=>{
    renderMessages();
    
    // Chat
    const sendBtn = document.getElementById('sendBtn');
    const messageText = document.getElementById('messageText');
    const attachAudio = document.getElementById('attachAudio');
    const recordBtn = document.getElementById('recordBtn');
    
    sendBtn.addEventListener('click', sendText);
    messageText.addEventListener('keydown', (e)=>{
        if(e.key==='Enter' && !e.shiftKey){
            e.preventDefault();
            sendText();
        }
    });
    
    attachAudio.addEventListener('change', (e)=>{
        if(e.target.files[0]) handleAudioFile(e.target.files[0]);
    });
    
    recordBtn.addEventListener('mousedown', ()=> startRecording(recordBtn));
    recordBtn.addEventListener('mouseup', ()=> stopRecording());
    recordBtn.addEventListener('touchstart', ()=> startRecording(recordBtn));
    recordBtn.addEventListener('touchend', ()=> stopRecording());
    
    // Contact Form
    const contactForm = document.getElementById('contactForm');
    if(contactForm){
        contactForm.addEventListener('submit', handleFormSubmit);
    }
});
