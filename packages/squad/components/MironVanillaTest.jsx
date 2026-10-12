import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './MironVanillaTest.css';

const MironVanillaTest = () => {
  const chatContainerRef = useRef(null);
  const promptInputRef = useRef(null);
  const sendIconRef = useRef(null);
  const stopIconRef = useRef(null);
  const emptyStateRef = useRef(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const abortControllerRef = useRef(null);
  const conversationHistory = useRef([]);

  useEffect(() => {
    // Load scripts dynamically to match HTML prototype perfectly
    const loadScript = (src) => new Promise(r => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = r;
        document.head.appendChild(s);
    });

    const addCss = (href) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
    };

    addCss("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css");
    addCss("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css");

    Promise.all([
        loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js"),
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"),
        loadScript("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js").then(() => 
            loadScript("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js")
        )
    ]).then(() => setScriptsLoaded(true));
  }, []);

  const setGenerating = (generating) => {
      setIsGenerating(generating);
      if (sendIconRef.current && stopIconRef.current) {
          sendIconRef.current.style.display = generating ? 'none' : 'block';
          stopIconRef.current.style.display = generating ? 'block' : 'none';
      }
      if (!generating) abortControllerRef.current = null;
  };

  const scrollToBottom = () => {
      if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
  };

  const appendMessage = (side, text = "") => {
      if (emptyStateRef.current) emptyStateRef.current.style.display = "none";
      const msgDiv = document.createElement("div");
      msgDiv.className = `vt-message ${side}`;
      if (side === "user") {
          msgDiv.textContent = text;
      }
      chatContainerRef.current.appendChild(msgDiv);
      scrollToBottom();
      return msgDiv;
  };

  const sendMessage = async () => {
      const userText = promptInputRef.current.value.trim();
      if (!userText || isGenerating || !scriptsLoaded) return;

      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      if (!authToken) {
          alert("No auth token found. Please sign in.");
          return;
      }

      // Hit Supabase Direct (bypass Cloudflare) just like the prototype test
      const functionUrl = 'https://ryaxynjczfwqyqvpmorl.supabase.co/functions/v1/miron-athena';

      appendMessage("user", userText);
      promptInputRef.current.value = "";
      promptInputRef.current.style.height = "22px";

      const aiContainer = appendMessage("model");

      const statusPill = document.createElement("div");
      statusPill.className = "vt-status-pill";
      statusPill.style.display = "none";
      aiContainer.appendChild(statusPill);

      const contentEl = document.createElement("div");
      contentEl.className = "vt-content-body";
      aiContainer.appendChild(contentEl);

      const cursor = document.createElement("span");
      cursor.className = "vt-cursor";
      aiContainer.appendChild(cursor);

      setGenerating(true);
      abortControllerRef.current = new AbortController();

      let accumulatedText = "";

      try {
          const headers = {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${authToken}`
          };

          const response = await fetch(functionUrl, {
              method: "POST",
              headers,
              signal: abortControllerRef.current.signal,
              body: JSON.stringify({
                  prompt: userText,
                  history: conversationHistory.current,
                  context: ""
              })
          });

          if (!response.ok) {
              const errText = await response.text().catch(() => "");
              throw new Error(`Edge Function Error (${response.status}): ${errText}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let buffer = "";

          while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith("data:")) continue;
                  const jsonStr = trimmed.replace(/^data:\s*/, "");
                  if (!jsonStr || jsonStr === "[DONE]") continue;

                  try {
                      const event = JSON.parse(jsonStr);

                      if (event.type === "status") {
                          statusPill.innerText = `⚙️ ${event.message}`;
                          statusPill.style.display = "inline-flex";
                          scrollToBottom();
                      } else if (event.type === "chunk") {
                          accumulatedText += event.delta;
                          contentEl.innerHTML = window.marked.parse(accumulatedText);
                          
                          window.renderMathInElement(contentEl, {
                              delimiters: [
                                  { left: "$$", right: "$$", display: true },
                                  { left: "$", right: "$", display: false }
                              ],
                              throwOnError: false
                          });

                          contentEl.querySelectorAll("pre code").forEach(el => window.hljs.highlightElement(el));

                          scrollToBottom();
                      } else if (event.type === "done") {
                          statusPill.style.display = "none";
                      } else if (event.type === "error") {
                          accumulatedText += `\n\n> ⚠️ **Error:** ${event.message}`;
                          contentEl.innerHTML = window.marked.parse(accumulatedText);
                      }
                  } catch (err) {}
              }
          }

          conversationHistory.current.push({ side: "user", text: userText });
          conversationHistory.current.push({ side: "model", text: accumulatedText });

      } catch (err) {
          if (err.name === "AbortError") {
              accumulatedText += "\n\n*(Generation stopped)*";
          } else {
              accumulatedText += `\n\n**Error:** ${err.message}`;
          }
          contentEl.innerHTML = window.marked.parse(accumulatedText);
      } finally {
          if (cursor.parentNode) cursor.remove();
          statusPill.style.display = "none";
          setGenerating(false);
          scrollToBottom();
      }
  };

  return (
    <div className="vt-root">
        <header className="vt-header">
            <div className="vt-title-area">
                <div className="vt-avatar">M</div>
                <div className="vt-meta">
                    <span className="vt-meta-title">Direct DOM Vanilla Streamer</span>
                    <span className="vt-meta-model">{scriptsLoaded ? 'React State Bypassed • Ready' : 'Loading Scripts...'}</span>
                </div>
            </div>
        </header>

        <main id="chat-container-vanilla" className="vt-chat-container" ref={chatContainerRef}>
            <div className="vt-empty-state" ref={emptyStateRef}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <h3 style={{color:'#fff', fontSize:'16px'}}>Diagnostic Terminal</h3>
                <p style={{fontSize:'13px', maxWidth: '280px'}}>This bypasses React state mapping entirely to test browser rendering capabilities.</p>
            </div>
        </main>

        <div className="vt-input-bar">
            <div className="vt-textarea-wrapper">
                <textarea 
                    ref={promptInputRef} 
                    placeholder="Type message to test stream..." 
                    rows="1"
                    onInput={(e) => {
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    }}
                ></textarea>
            </div>
            <button 
                className="vt-action-btn" 
                onClick={() => {
                    if (isGenerating) {
                        if (abortControllerRef.current) abortControllerRef.current.abort();
                        setGenerating(false);
                    } else {
                        sendMessage();
                    }
                }}
            >
                <svg ref={sendIconRef} width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
                <svg ref={stopIconRef} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{display:'none'}}>
                    <rect x="5" y="5" width="14" height="14" rx="2"/>
                </svg>
            </button>
        </div>
    </div>
  );
};

export default MironVanillaTest;