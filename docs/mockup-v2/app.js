/* ═══════════════════════════════════════════════════════════ */
/* OpenClaw Control V2 — Mockup Navigation & Interactions     */
/* ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  const pages = document.querySelectorAll('.page');
  const settingsModal = document.getElementById('chatSettingsModal');

  // --- Utility: open/close settings modal ---
  function toggleSettingsModal(show) {
    if (settingsModal) settingsModal.classList.toggle('open', show);
  }

  // --- Page navigation ---
  function navigateTo(pageId) {
    pages.forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.add('active');
    toggleSettingsModal(false);
  }

  // Modal nav items (inside the ⚙️ modal)
  document.querySelectorAll('.modal-nav-item[data-page]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // Card links that navigate pages
  document.querySelectorAll('[data-page]').forEach(el => {
    if (!el.classList.contains('modal-nav-item')) {
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });

  // "← Back to Menu" button on every non-chat page header — reopens the modal
  document.querySelectorAll('.page-header').forEach(header => {
    const btn = document.createElement('button');
    btn.className = 'back-to-menu';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg> Back to Menu';
    btn.addEventListener('click', () => {
      navigateTo('chat');
      requestAnimationFrame(() => toggleSettingsModal(true));
    });
    header.insertBefore(btn, header.firstChild);
  });

  // --- Sidebar toggle ---
  const chatConv = document.getElementById('chatConversations');
  const toggleConv = document.getElementById('toggleConversations');
  const openSidebarBtn = document.getElementById('openSidebar');

  function setSidebarVisible(visible) {
    if (!chatConv) return;
    chatConv.classList.toggle('hidden', !visible);
    if (openSidebarBtn) openSidebarBtn.style.display = visible ? 'none' : '';
  }

  if (toggleConv) {
    toggleConv.addEventListener('click', () => {
      const isVisible = !chatConv.classList.contains('hidden');
      setSidebarVisible(!isVisible);
    });
  }
  if (openSidebarBtn) {
    openSidebarBtn.addEventListener('click', () => setSidebarVisible(true));
  }

  // --- Chat Settings Modal open/close ---
  const openSettings = document.getElementById('openChatSettings');
  const closeSettings = document.getElementById('closeChatSettings');
  const settingsOverlay = document.getElementById('chatSettingsOverlayBg');
  if (openSettings) openSettings.addEventListener('click', () => toggleSettingsModal(true));
  if (closeSettings) closeSettings.addEventListener('click', () => toggleSettingsModal(false));
  if (settingsOverlay) settingsOverlay.addEventListener('click', () => toggleSettingsModal(false));

  // --- Thinking block toggle ---
  document.querySelectorAll('.thinking-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const content = btn.nextElementSibling;
      if (content) content.classList.toggle('collapsed');
      const chevron = btn.querySelector('.thinking-chevron');
      if (chevron) {
        chevron.style.transform = content.classList.contains('collapsed') ? '' : 'rotate(180deg)';
      }
    });
  });

  // --- Auto-resize textarea ---
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    });
  }

  // --- Simulated send ---
  const sendBtn = document.getElementById('sendBtn');
  const chatMessages = document.getElementById('chatMessages');
  const typingIndicator = document.getElementById('typingIndicator');

  // ═══════════════════════════════════════════════════════════
  // FILE ATTACHMENT (real file picker) — declared early for sendMessage
  // ═══════════════════════════════════════════════════════════
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const attachmentsEl = document.getElementById('attachments');
  let currentAttachments = [];

  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = '';
    if (currentAttachments.length === 0) { attachmentsEl.style.display = 'none'; return; }
    attachmentsEl.style.display = 'flex';
    currentAttachments.forEach((file, idx) => {
      const ext = file.name.split('.').pop().toLowerCase();
      const isImage = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
      const isVideo = ['mp4','webm','mov','avi','mkv'].includes(ext);
      const icon = isImage ? '🖼️' : isVideo ? '🎬' : '📄';
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.innerHTML = `<span class="attachment-icon">${icon}</span><span class="attachment-name">${file.name}</span><button class="attachment-remove" data-idx="${idx}">×</button>`;
      attachmentsEl.appendChild(chip);
    });
    attachmentsEl.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        currentAttachments.splice(parseInt(btn.dataset.idx), 1);
        renderAttachments();
      });
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (!fileInput.files.length) return;
      for (const f of fileInput.files) currentAttachments.push(f);
      fileInput.value = '';
      renderAttachments();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SEND MESSAGE (with attachments + resend)
  // ═══════════════════════════════════════════════════════════
  function getTimeStr() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // Build attachment HTML for display inside a message
  function buildAttachmentHTML(files) {
    if (!files || files.length === 0) return '';
    let html = '<div class="msg-attachments">';
    files.forEach(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      const isImage = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
      const isVideo = ['mp4','webm','mov','avi','mkv'].includes(ext);
      const icon = isImage ? '🖼️' : isVideo ? '🎬' : '📄';
      html += `<span class="msg-attachment-chip">${icon} ${f.name}</span>`;
    });
    html += '</div>';
    return html;
  }

  // Remove edit/resend buttons from all previous user messages (only last gets them)
  function updateUserMessageActions() {
    const userMsgs = chatMessages.querySelectorAll('.message-user');
    userMsgs.forEach((msg, i) => {
      const actions = msg.querySelector('.message-actions');
      if (!actions) return;
      const isLast = i === userMsgs.length - 1;
      actions.style.display = isLast ? '' : 'none';
    });
  }

  if (sendBtn && chatInput && chatMessages) {
    function sendMessage(opts = {}) {
      const text = chatInput.value.trim();
      if (!text && currentAttachments.length === 0) return;

      const filesSnapshot = [...currentAttachments];
      const userMsg = document.createElement('div');
      userMsg.className = 'message message-user';
      userMsg.innerHTML = `
        <div class="message-content">
          <div class="message-header">
            <span class="message-author">You</span>
            <span class="message-time">${getTimeStr()}</span>
          </div>
          <div class="message-body">${text ? `<p>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}${buildAttachmentHTML(filesSnapshot)}</div>
          <div class="message-actions">
            <button class="msg-action-btn msg-edit-btn" title="Edit message">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="msg-action-btn msg-resend-btn" title="Resend">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
          </div>
        </div>
        <div class="message-avatar message-avatar-user">U</div>
      `;
      // Store attachments data on the DOM element for edit retrieval
      userMsg._attachments = filesSnapshot;
      chatMessages.appendChild(userMsg);
      chatInput.value = '';
      chatInput.style.height = 'auto';
      currentAttachments = [];
      renderAttachments();
      updateUserMessageActions();
      bindUserMsgActions(userMsg);

      if (typingIndicator) { typingIndicator.style.display = 'flex'; chatMessages.scrollTop = chatMessages.scrollHeight; }
      setTimeout(() => {
        if (typingIndicator) typingIndicator.style.display = 'none';
        const assistantMsg = document.createElement('div');
        assistantMsg.className = 'message message-assistant';
        assistantMsg.innerHTML = `
          <div class="message-avatar">🦞</div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-author">Assistant</span>
              <span class="message-time">${getTimeStr()}</span>
              <span class="message-model-badge">gpt-5.2</span>
            </div>
            <div class="message-body markdown-body">
              <p>This is a simulated response in the V2 mockup.</p>
            </div>
            <div class="message-actions">
              <button class="msg-action-btn" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
              <button class="msg-action-btn" title="Regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
              <button class="msg-action-btn" title="Read aloud"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>
            </div>
          </div>
        `;
        chatMessages.appendChild(assistantMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }, 1500);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    sendBtn.addEventListener('click', () => sendMessage());
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // EDIT / RESEND last user message (inline editing in bubble)
  // ═══════════════════════════════════════════════════════════
  function bindUserMsgActions(msgEl) {
    const editBtn = msgEl.querySelector('.msg-edit-btn');
    const resendBtn = msgEl.querySelector('.msg-resend-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const body = msgEl.querySelector('.message-body');
        if (!body || body.classList.contains('editing')) return;
        const pEl = body.querySelector('p');
        const currentText = pEl?.textContent || '';
        const savedAttachments = msgEl._attachments || [];
        const savedHTML = body.innerHTML;

        body.classList.add('editing');
        body.innerHTML = '';

        // Textarea for inline editing
        const ta = document.createElement('textarea');
        ta.className = 'inline-edit-textarea';
        ta.value = currentText;
        ta.rows = Math.max(2, Math.ceil(currentText.length / 60));
        body.appendChild(ta);

        // Show attachment chips if any
        if (savedAttachments.length) {
          const attDiv = document.createElement('div');
          attDiv.className = 'msg-attachments';
          attDiv.innerHTML = savedAttachments.map(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            const isImg = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
            const isVid = ['mp4','webm','mov','avi','mkv'].includes(ext);
            const icon = isImg ? '🖼️' : isVid ? '🎬' : '📄';
            return `<span class="msg-attachment-chip">${icon} ${f.name}</span>`;
          }).join('');
          body.appendChild(attDiv);
        }

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'inline-edit-actions';
        actions.innerHTML = `<button class="inline-edit-save">Save</button><button class="inline-edit-cancel">Cancel</button>`;
        body.appendChild(actions);

        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);

        actions.querySelector('.inline-edit-save').addEventListener('click', () => {
          const newText = ta.value.trim();
          body.classList.remove('editing');
          body.innerHTML = (newText ? `<p>${newText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : '') + buildAttachmentHTML(savedAttachments);
        });
        actions.querySelector('.inline-edit-cancel').addEventListener('click', () => {
          body.classList.remove('editing');
          body.innerHTML = savedHTML;
        });
      });
    }
    if (resendBtn) {
      resendBtn.addEventListener('click', () => {
        const body = msgEl.querySelector('.message-body');
        const pEl = body?.querySelector('p');
        const text = pEl?.textContent || '';
        if (!text) return;
        chatInput.value = text;
        sendMessage();
      });
    }
  }
  // Bind static user messages
  document.querySelectorAll('.message-user').forEach(bindUserMsgActions);

  // ═══════════════════════════════════════════════════════════
  // MICROPHONE (recording simulation)
  // ═══════════════════════════════════════════════════════════
  const voiceBtn = document.getElementById('voiceBtn');
  let isRecording = false;
  let recordingInterval = null;
  let recordingSeconds = 0;

  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      isRecording = !isRecording;
      if (isRecording) {
        voiceBtn.classList.add('recording');
        voiceBtn.title = 'Stop recording';
        recordingSeconds = 0;
        // Show recording indicator in input
        if (chatInput) {
          chatInput.dataset.prevPlaceholder = chatInput.placeholder;
          chatInput.placeholder = 'Recording… 0:00';
          chatInput.disabled = true;
        }
        recordingInterval = setInterval(() => {
          recordingSeconds++;
          const m = Math.floor(recordingSeconds / 60);
          const s = String(recordingSeconds % 60).padStart(2, '0');
          if (chatInput) chatInput.placeholder = `Recording… ${m}:${s}`;
        }, 1000);
      } else {
        voiceBtn.classList.remove('recording');
        voiceBtn.title = 'Voice input';
        clearInterval(recordingInterval);
        if (chatInput) {
          chatInput.disabled = false;
          chatInput.placeholder = chatInput.dataset.prevPlaceholder || 'Message… (↵ send, Shift+↵ newline)';
          // Simulate transcription result
          const m = Math.floor(recordingSeconds / 60);
          const s = String(recordingSeconds % 60).padStart(2, '0');
          chatInput.value = `[Voice message ${m}:${s}] Transcribed audio content…`;
          chatInput.focus();
          chatInput.style.height = 'auto';
          chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SKILLS POPOVER
  // ═══════════════════════════════════════════════════════════
  const skillsBtn = document.getElementById('skillsBtn');
  const skillsPopover = document.getElementById('skillsPopover');
  const skillsCount = document.getElementById('skillsCount');

  function updateSkillsCount() {
    if (skillsCount) {
      skillsCount.textContent = document.querySelectorAll('.skill-toggle.active').length;
    }
  }

  if (skillsBtn && skillsPopover) {
    skillsBtn.addEventListener('click', e => {
      e.stopPropagation();
      skillsPopover.classList.toggle('open');
    });
  }

  document.querySelectorAll('.skill-toggle').forEach(chip => {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      chip.classList.toggle('active');
      updateSkillsCount();
    });
  });

  // Close skills popover on outside click
  document.addEventListener('click', e => {
    if (skillsPopover && !skillsPopover.contains(e.target) && e.target !== skillsBtn) {
      skillsPopover.classList.remove('open');
    }
  });

  // ═══════════════════════════════════════════════════════════
  // PROJECT GROUP COLLAPSE + DELETE
  // ═══════════════════════════════════════════════════════════
  document.querySelectorAll('.project-header').forEach(header => {
    header.addEventListener('click', e => {
      if (e.target.closest('.project-delete-btn')) return;
      header.closest('.project-group').classList.toggle('collapsed');
    });
  });

  // Delete project button → opens confirmation modal
  let projectToDelete = null;
  const deleteProjectModal = document.getElementById('deleteProjectModal');
  const deleteProjectCancel = document.getElementById('deleteProjectCancel');
  const deleteProjectOk = document.getElementById('deleteProjectOk');
  const deleteProjectTitle = document.getElementById('deleteProjectTitle');

  function bindProjectDeleteBtn(btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const group = btn.closest('.project-group');
      projectToDelete = group;
      const name = group.querySelector('.project-name')?.textContent || 'this project';
      if (deleteProjectTitle) deleteProjectTitle.textContent = `Delete "${name}"?`;
      if (deleteProjectModal) deleteProjectModal.classList.add('open');
    });
  }
  document.querySelectorAll('.project-delete-btn').forEach(bindProjectDeleteBtn);

  if (deleteProjectCancel) deleteProjectCancel.addEventListener('click', () => { deleteProjectModal.classList.remove('open'); projectToDelete = null; });
  deleteProjectModal?.querySelector('.confirm-overlay')?.addEventListener('click', () => { deleteProjectModal.classList.remove('open'); projectToDelete = null; });

  if (deleteProjectOk) {
    deleteProjectOk.addEventListener('click', () => {
      if (!projectToDelete) return;
      // Move conversations back to ungrouped list
      const list = document.querySelector('.conversations-list');
      const firstLabel = list.querySelector('.conversations-group-label');
      const items = projectToDelete.querySelectorAll('.conversation-item');
      items.forEach(item => {
        if (firstLabel) list.insertBefore(item, firstLabel);
        else list.appendChild(item);
      });
      // Remove from context menu project list
      const slug = projectToDelete.querySelector('.project-header')?.dataset.project;
      if (slug) {
        document.querySelectorAll(`.ctx-item[data-project="${slug}"]`).forEach(el => el.remove());
      }
      projectToDelete.remove();
      deleteProjectModal.classList.remove('open');
      projectToDelete = null;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CONVERSATION CONTEXT MENU
  // ═══════════════════════════════════════════════════════════
  const ctxMenu = document.getElementById('convContextMenu');
  const removeProjectBtn = ctxMenu?.querySelector('.ctx-remove-project');
  let ctxTarget = null;

  document.querySelectorAll('.conv-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      ctxTarget = btn.closest('.conversation-item');
      const rect = btn.getBoundingClientRect();
      ctxMenu.style.top = rect.bottom + 4 + 'px';
      ctxMenu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
      // Show/hide "Remove from project" based on whether chat is in a project
      const isInProject = !!ctxTarget.closest('.project-group');
      if (removeProjectBtn) removeProjectBtn.classList.toggle('visible', isInProject);
      ctxMenu.classList.add('open');
    });
  });

  document.addEventListener('click', e => {
    if (ctxMenu && !ctxMenu.contains(e.target) && !e.target.classList.contains('conv-menu-btn')) {
      ctxMenu.classList.remove('open');
    }
  });

  // ═══════════════════════════════════════════════════════════
  // CONFIRMATION MODAL (delete / archive chat)
  // ═══════════════════════════════════════════════════════════
  const confirmModal = document.getElementById('confirmModal');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmDesc = document.getElementById('confirmDesc');
  const confirmOk = document.getElementById('confirmOk');
  const confirmCancel = document.getElementById('confirmCancel');
  const confirmIcon = document.getElementById('confirmIcon');
  let pendingAction = null;

  function showConfirm(title, desc, okLabel, onConfirm) {
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmDesc) confirmDesc.textContent = desc;
    if (confirmOk) confirmOk.textContent = okLabel;
    pendingAction = onConfirm;
    if (confirmModal) confirmModal.classList.add('open');
  }
  function closeConfirm() {
    if (confirmModal) confirmModal.classList.remove('open');
    pendingAction = null;
  }
  if (confirmCancel) confirmCancel.addEventListener('click', closeConfirm);
  confirmModal?.querySelector('.confirm-overlay')?.addEventListener('click', closeConfirm);
  if (confirmOk) {
    confirmOk.addEventListener('click', () => {
      if (pendingAction) pendingAction();
      closeConfirm();
    });
  }

  // Temporal ordering map: conv-id → sort weight (lower = more recent)
  const convOrder = { c1: 10, c2: 20, c3: 30, c4: 31, c7: 40, c5: 50, c6: 60 };

  // Map conv-id to its date section label for correct placement
  const convSection = { c1: 'Today', c2: 'Today', c3: 'Yesterday', c4: 'Yesterday', c7: 'Today', c5: 'Today', c6: 'Today' };

  // Reinsert a conversation at its correct temporal position among ungrouped items
  function insertConvTemporally(el) {
    const list = document.querySelector('.conversations-list');
    const weight = convOrder[el.dataset.convId] ?? 999;
    const section = convSection[el.dataset.convId]?.toLowerCase();
    // Find the section label this conversation belongs to
    const labels = [...list.querySelectorAll(':scope > .conversations-group-label')];
    let sectionLabel = null;
    for (const lbl of labels) {
      if (lbl.textContent.trim().toLowerCase() === section) { sectionLabel = lbl; break; }
    }
    if (sectionLabel) {
      // Insert within this section: walk siblings after the label, find correct position
      let sibling = sectionLabel.nextElementSibling;
      let lastInSection = sectionLabel; // fallback: insert right after label
      while (sibling && sibling.classList.contains('conversation-item')) {
        const sw = convOrder[sibling.dataset.convId] ?? 999;
        if (weight < sw) {
          list.insertBefore(el, sibling);
          return;
        }
        lastInSection = sibling;
        sibling = sibling.nextElementSibling;
      }
      // Append after the last item in the section
      if (lastInSection.nextSibling) list.insertBefore(el, lastInSection.nextSibling);
      else list.appendChild(el);
    } else {
      // Fallback: append at end
      list.appendChild(el);
    }
  }

  // Context menu actions
  document.querySelectorAll('.ctx-item[data-action]').forEach(item => {
    item.addEventListener('click', () => {
      if (!ctxTarget) return;
      const action = item.dataset.action;

      if (action === 'pin') {
        const wasPinned = ctxTarget.classList.toggle('pinned');
        const pinnedItems = document.querySelector('.pinned-group .project-items');
        const pinnedCount = document.querySelector('.pinned-group .project-count');
        if (wasPinned && pinnedItems) {
          pinnedItems.appendChild(ctxTarget);
        } else if (!wasPinned) {
          // Reinsert at correct temporal position based on conversation ordering
          insertConvTemporally(ctxTarget);
        }
        if (pinnedCount) pinnedCount.textContent = document.querySelectorAll('.pinned-group .conversation-item.pinned').length;
        ctxMenu.classList.remove('open');

      } else if (action === 'archive') {
        ctxMenu.classList.remove('open');
        showConfirm('Archive conversation?', 'The conversation will be moved to the archive. You can unarchive it later.', 'Archive', () => {
          ctxTarget.classList.toggle('archived');
          const icon = ctxTarget.querySelector('.conversation-icon');
          if (ctxTarget.classList.contains('archived') && icon) icon.textContent = '📦';
        });

      } else if (action === 'delete') {
        ctxMenu.classList.remove('open');
        const title = ctxTarget.querySelector('.conversation-title')?.textContent || 'this conversation';
        showConfirm(`Delete "${title}"?`, 'This action cannot be undone. The conversation and its messages will be permanently removed.', 'Delete', () => {
          ctxTarget.style.transition = 'opacity .3s, max-height .3s';
          ctxTarget.style.opacity = '0';
          ctxTarget.style.maxHeight = '0';
          ctxTarget.style.overflow = 'hidden';
          setTimeout(() => ctxTarget.remove(), 300);
        });

      } else if (action === 'move-to') {
        const projectId = item.dataset.project;
        if (projectId === 'none') {
          const list = document.querySelector('.conversations-list');
          const firstLabel = list.querySelector('.conversations-group-label');
          if (firstLabel) list.insertBefore(ctxTarget, firstLabel);
        } else {
          const projectItems = document.querySelector(`.project-header[data-project="${projectId}"]`)
            ?.closest('.project-group')?.querySelector('.project-items');
          if (projectItems) projectItems.appendChild(ctxTarget);
        }
        ctxMenu.classList.remove('open');
      }
    });
  });

  // --- Conversation item click ---
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.conv-menu-btn')) return;
      document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // --- Suggestion chips ---
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chatInput) { chatInput.value = chip.textContent.replace(/^[^\w]+/, '').trim(); chatInput.focus(); }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CREATE PROJECT MODAL (replaces prompt())
  // ═══════════════════════════════════════════════════════════
  const newProjectBtn = document.getElementById('newProjectBtn');
  const createProjectModal = document.getElementById('createProjectModal');
  const createProjectCancel = document.getElementById('createProjectCancel');
  const createProjectOk = document.getElementById('createProjectOk');
  const projectNameInput = document.getElementById('projectNameInput');

  if (newProjectBtn && createProjectModal) {
    newProjectBtn.addEventListener('click', () => {
      if (projectNameInput) projectNameInput.value = '';
      createProjectModal.classList.add('open');
      requestAnimationFrame(() => projectNameInput?.focus());
    });
  }
  if (createProjectCancel) createProjectCancel.addEventListener('click', () => createProjectModal.classList.remove('open'));
  createProjectModal?.querySelector('.confirm-overlay')?.addEventListener('click', () => createProjectModal.classList.remove('open'));

  // Enter key in project name input
  if (projectNameInput) {
    projectNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); createProjectOk?.click(); }
    });
  }

  if (createProjectOk) {
    createProjectOk.addEventListener('click', () => {
      const name = projectNameInput?.value.trim();
      if (!name) return;
      createProjectModal.classList.remove('open');
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const list = document.querySelector('.conversations-list');
      const group = document.createElement('div');
      group.className = 'project-group';
      group.innerHTML = `
        <div class="project-header" data-project="${slug}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="project-name">${name}</span>
          <span class="project-count">0</span>
          <button class="project-delete-btn" title="Delete project">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="project-chevron"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="project-items"></div>
      `;
      list.insertBefore(group, list.firstChild);
      // Collapse toggle
      group.querySelector('.project-header').addEventListener('click', e => {
        if (e.target.closest('.project-delete-btn')) return;
        group.classList.toggle('collapsed');
      });
      // Bind delete btn
      bindProjectDeleteBtn(group.querySelector('.project-delete-btn'));
      // Add to context menu project list
      const ctxList = document.getElementById('ctxProjectList');
      if (ctxList) {
        const btn = document.createElement('button');
        btn.className = 'ctx-item';
        btn.dataset.action = 'move-to';
        btn.dataset.project = slug;
        btn.textContent = name;
        const removeBtnEl = ctxList.querySelector('.ctx-remove-project');
        if (removeBtnEl) ctxList.insertBefore(btn, removeBtnEl);
        else ctxList.appendChild(btn);
        btn.addEventListener('click', () => {
          if (ctxTarget) {
            group.querySelector('.project-items').appendChild(ctxTarget);
            ctxMenu.classList.remove('open');
          }
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // NEW CHAT
  // ═══════════════════════════════════════════════════════════
  const newChatBtn = document.getElementById('newChatBtn');
  let chatCounter = 100; // id counter for dynamic conversations

  function startNewChat() {
    // Deselect all conversations
    document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));

    // Clear chat messages
    if (chatMessages) {
      chatMessages.innerHTML = '';
      // Fresh session separator
      const sep = document.createElement('div');
      sep.className = 'session-separator';
      sep.innerHTML = `<span class="session-separator-line"></span><span class="session-separator-text">New session started · gpt-5.2 · ${getTimeStr()}</span><span class="session-separator-line"></span>`;
      chatMessages.appendChild(sep);

      // Assistant greeting
      const greeting = document.createElement('div');
      greeting.className = 'message message-assistant';
      greeting.innerHTML = `
        <div class="message-avatar">🦞</div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-author">Assistant</span>
            <span class="message-time">${getTimeStr()}</span>
            <span class="message-model-badge">gpt-5.2</span>
          </div>
          <div class="message-body">
            <p>Hey — I'm online and ready. What do you want to do today?</p>
            <div class="message-suggestions">
              <button class="suggestion-chip">📝 Write code</button>
              <button class="suggestion-chip">📋 Plan a project</button>
              <button class="suggestion-chip">🔍 Search the web</button>
              <button class="suggestion-chip">📊 Analyze data</button>
            </div>
          </div>
        </div>
      `;
      chatMessages.appendChild(greeting);

      // Re-bind suggestion chips
      greeting.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          if (chatInput) { chatInput.value = chip.textContent.replace(/^[^\w]+/, '').trim(); chatInput.focus(); }
        });
      });

      // Re-add typing indicator
      const indicator = document.createElement('div');
      indicator.className = 'message message-assistant typing-indicator';
      indicator.id = 'typingIndicator';
      indicator.style.display = 'none';
      indicator.innerHTML = '<div class="message-avatar">🦞</div><div class="message-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
      chatMessages.appendChild(indicator);
    }

    // Add new conversation to sidebar
    chatCounter++;
    const convId = `c${chatCounter}`;
    const convItem = document.createElement('div');
    convItem.className = 'conversation-item active';
    convItem.dataset.convId = convId;
    convItem.innerHTML = `
      <div class="conversation-info">
        <div class="conversation-title">New conversation</div>
        <div class="conversation-preview">Start typing…</div>
      </div>
      <div class="conversation-meta">${getTimeStr()}</div>
      <button class="conv-menu-btn" title="More">⋯</button>
    `;
    // Insert after the "Today" label
    const list = document.querySelector('.conversations-list');
    const todayLabel = [...list.querySelectorAll('.conversations-group-label')].find(l => l.textContent.trim().toLowerCase() === 'today');
    if (todayLabel) {
      list.insertBefore(convItem, todayLabel.nextSibling);
    } else {
      const firstLabel = list.querySelector('.conversations-group-label');
      if (firstLabel) list.insertBefore(convItem, firstLabel);
      else list.appendChild(convItem);
    }

    // Bind click + context menu on new item
    convItem.addEventListener('click', e => {
      if (e.target.closest('.conv-menu-btn')) return;
      document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
      convItem.classList.add('active');
    });
    convItem.querySelector('.conv-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      ctxTarget = convItem;
      const rect = e.currentTarget.getBoundingClientRect();
      ctxMenu.style.top = rect.bottom + 4 + 'px';
      ctxMenu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
      const isInProject = !!convItem.closest('.project-group');
      if (removeProjectBtn) removeProjectBtn.classList.toggle('visible', isInProject);
      ctxMenu.classList.add('open');
    });

    // Update header title
    const titleEl = document.querySelector('.chat-title-text');
    if (titleEl) titleEl.textContent = 'New conversation';

    // Focus input
    if (chatInput) { chatInput.value = ''; chatInput.focus(); }
  }

  if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

  // ═══════════════════════════════════════════════════════════
  // SEARCH MODAL
  // ═══════════════════════════════════════════════════════════
  const searchModal = document.getElementById('searchModal');
  const openSearchBtn = document.getElementById('openSearchModal');
  const closeSearchBtn = document.getElementById('closeSearchModal');
  const searchInput = document.getElementById('searchModalInput');
  const searchResults = document.getElementById('searchResults');
  const searchNewChatBtn = document.getElementById('searchNewChat');

  // Collect all conversations for search index
  function getSearchableConversations() {
    const items = [];
    document.querySelectorAll('.conversation-item').forEach(el => {
      const title = el.querySelector('.conversation-title')?.textContent || '';
      const preview = el.querySelector('.conversation-preview')?.textContent || '';
      const meta = el.querySelector('.conversation-meta')?.textContent || '';
      // Determine section
      let section = 'Other';
      const parent = el.closest('.project-group');
      if (parent) {
        section = parent.querySelector('.project-name')?.textContent || 'Project';
      } else {
        // Walk backwards from el to find the preceding group label
        let prev = el.previousElementSibling;
        while (prev) {
          if (prev.classList.contains('conversations-group-label')) { section = prev.textContent.trim(); break; }
          if (prev.classList.contains('project-group')) break;
          prev = prev.previousElementSibling;
        }
      }
      items.push({ el, title, preview, meta, section });
    });
    return items;
  }

  function renderSearchResults(query) {
    if (!searchResults) return;
    searchResults.innerHTML = '';
    const all = getSearchableConversations();
    const q = query.toLowerCase().trim();
    const filtered = q ? all.filter(c => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : all;

    if (filtered.length === 0 && q) {
      searchResults.innerHTML = '<div class="search-no-results">No conversations found</div>';
      return;
    }

    // Group by section
    const groups = {};
    filtered.forEach(c => {
      if (!groups[c.section]) groups[c.section] = [];
      groups[c.section].push(c);
    });

    for (const [section, convs] of Object.entries(groups)) {
      const label = document.createElement('div');
      label.className = 'search-section-label';
      label.textContent = section;
      searchResults.appendChild(label);

      convs.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'search-result-item';
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${c.title}</span>
          <span class="search-result-meta">${c.meta}</span>
        `;
        btn.addEventListener('click', () => {
          // Activate the conversation
          document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
          c.el.classList.add('active');
          c.el.scrollIntoView({ block: 'nearest' });
          const titleEl = document.querySelector('.chat-title-text');
          if (titleEl) titleEl.textContent = c.title;
          closeSearch();
        });
        searchResults.appendChild(btn);
      });
    }
  }

  function openSearch() {
    if (!searchModal) return;
    searchModal.classList.add('open');
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    renderSearchResults('');
  }

  function closeSearch() {
    if (searchModal) searchModal.classList.remove('open');
  }

  if (openSearchBtn) openSearchBtn.addEventListener('click', openSearch);
  if (closeSearchBtn) closeSearchBtn.addEventListener('click', closeSearch);
  searchModal?.querySelector('.search-modal-overlay')?.addEventListener('click', closeSearch);

  if (searchInput) {
    searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
  }

  // Escape closes search modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchModal?.classList.contains('open')) { closeSearch(); e.stopPropagation(); }
  });

  // "New chat" button inside search modal
  if (searchNewChatBtn) {
    searchNewChatBtn.addEventListener('click', () => {
      closeSearch();
      startNewChat();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // THEME TOGGLE (single button, swap icon)
  // ═══════════════════════════════════════════════════════════
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (!themeToggleBtn) return;
    const moonIcon = themeToggleBtn.querySelector('.icon-moon');
    const sunIcon = themeToggleBtn.querySelector('.icon-sun');
    if (theme === 'dark') {
      if (moonIcon) moonIcon.style.display = '';
      if (sunIcon) sunIcon.style.display = 'none';
    } else {
      if (moonIcon) moonIcon.style.display = 'none';
      if (sunIcon) sunIcon.style.display = '';
    }
  }
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }
});
