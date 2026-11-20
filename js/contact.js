let messages = [];
const conversationId = createConversationId();

function createConversationId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadMessages() {
    return messages;
}

function saveMessages(items) {
    messages = items;
}

async function storeMessage(message) {
    const client = window.supabaseClient;
    if (!client) throw new Error('Client Supabase indisponible.');

    const { error } = await client.from('contact_messages').insert({
        conversation_id: conversationId,
        sender: 'visitor',
        message_type: message.type,
        content: message.content,
        sender_name: message.name || null,
        sender_email: message.email || null,
        sender_phone: message.phone || null,
        subject: message.subject || null
    });

    if (error) throw error;

    return {
        id: null,
        sender: 'user',
        type: message.type,
        content: message.content,
        time: new Date().toISOString()
    };
}

function renderMessages(){
    const list = document.getElementById('messages');
    if (!list) return;
    list.innerHTML = '';
    const msgs = loadMessages();
    msgs.forEach((m) => {
        const div = document.createElement('div');
        div.className = 'bubble ' + (m.sender==='user'? 'user':'admin');
        if(m.type === 'audio'){
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = m.content;
            div.appendChild(audio);
        }
        else {
            const text = document.createElement('div');
            text.textContent = m.content;
            div.appendChild(text);
        }
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date(m.time).toLocaleString('fr-FR');
        div.appendChild(meta);
        list.appendChild(div);
    });
    setTimeout(() => {
        list.scrollTop = list.scrollHeight;
    }, 0);
}

async function sendText() {
    const ta = document.getElementById('messageText');
    const v = ta.value.trim();
    if(!v) return;

    const savedMessage = await storeMessage({ type: 'text', content: v });
    const msgs = loadMessages();
    msgs.push(savedMessage);
    saveMessages(msgs);
    renderMessages();
    ta.value='';
    ta.focus();
}

async function handleAudioFile(file) {
    if (!file.type.startsWith('audio/') || file.size > 5 * 1024 * 1024) {
        alert('Choisissez un fichier audio de 5 Mo maximum.');
        return;
    }

    const reader = new FileReader();
    const data = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Impossible de lire le fichier audio.'));
        reader.readAsDataURL(file);
    });
    const savedMessage = await storeMessage({
        type: 'audio',
        content: String(data)
    });
    const msgs = loadMessages();
    msgs.push(savedMessage);
    saveMessages(msgs);
    renderMessages();
}

function reportContactError(error) {
    console.error('Envoi du message de contact impossible :', error);
    alert('Impossible d’envoyer le message. Vérifiez la connexion et réessayez.');
}

function handleAudioSelection(event) {
    const file = event.target.files[0];
    if (!file) return;
    handleAudioFile(file).catch(reportContactError).finally(() => {
        event.target.value = '';
    });
}

function reportFormError(error) {
    console.error('Envoi du formulaire de contact impossible :', error);
    alert('Impossible d’envoyer le formulaire. Vérifiez la connexion et réessayez.');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const subject = document.getElementById('subject').value;
    const message = document.getElementById('message').value.trim();

    if(!name || !email || !phone || !subject || !message) return;

    const savedMessage = await storeMessage({
        type: 'contact',
        content: message,
        name,
        email,
        phone,
        subject
    });
    const msgs = loadMessages();
    msgs.push(savedMessage);
    saveMessages(msgs);
    renderMessages();
    form.reset();

    const btn = form.querySelector('.btn-submit');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Envoyé!';
    btn.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';

    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
    }, 3000);
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
            handleAudioFile(blob).catch(reportContactError);
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

// Initialize
window.addEventListener('DOMContentLoaded', ()=>{
    renderMessages();
    
    // Chat
    const sendBtn = document.getElementById('sendBtn');
    const messageText = document.getElementById('messageText');
    const attachAudio = document.getElementById('attachAudio');
    const recordBtn = document.getElementById('recordBtn');
    
    sendBtn.addEventListener('click', () => sendText().catch(reportContactError));
    messageText.addEventListener('keydown', (e)=>{
        if(e.key==='Enter' && !e.shiftKey){
            e.preventDefault();
            sendText().catch(reportContactError);
        }
    });
    
    attachAudio.addEventListener('change', handleAudioSelection);
    
    recordBtn.addEventListener('mousedown', ()=> startRecording(recordBtn));
    recordBtn.addEventListener('mouseup', ()=> stopRecording());
    recordBtn.addEventListener('touchstart', ()=> startRecording(recordBtn));
    recordBtn.addEventListener('touchend', ()=> stopRecording());
    
    // Contact Form
    const contactForm = document.getElementById('contactForm');
    if(contactForm){
        contactForm.addEventListener('submit', (event) => {
            handleFormSubmit(event).catch(reportFormError);
        });
    }
});
