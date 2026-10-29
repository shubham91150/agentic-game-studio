lucide.createIcons();

      let attachments = [];
      let isRunning = false;
      let currentPlayUrl = "";

      function autoGrow(textarea) {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
      }

      function handleKey(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          handleSend();
        }
      }

      function appendConsole(text, type = "info") {
        const box = document.getElementById("console-stream");
        // Remove initial welcome hint if present
        const hint = box.querySelector(".italic");
        if (hint) hint.remove();

        const div = document.createElement("div");
        div.className =
          "font-mono text-xs py-0.5 whitespace-pre-wrap word-break";

        const time = new Date().toLocaleTimeString();
        let colorClass = "text-zinc-300";
        if (type === "ok") colorClass = "text-emerald-400 font-medium";
        else if (type === "warn") colorClass = "text-amber-400";
        else if (type === "error") colorClass = "text-rose-400 font-medium";
        else if (type === "cli") colorClass = "text-sky-300";
        else if (type === "reason") colorClass = "text-purple-300";

        div.innerHTML = `<span class="text-zinc-600 mr-2">[${time}]</span><span class="${colorClass}">${escapeHtml(text)}</span>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
      }

      function escapeHtml(str) {
        return str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      async function handleFileSelect(e) {
        const files = e.target.files;
        if (!files || !files.length) return;
        for (const file of files) {
          try {
            appendConsole(`Uploading attachment "${file.name}"...`, "info");
            const res = await fetch(
              `/api/studio/upload?name=${encodeURIComponent(file.name)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: file,
              },
            );
            if (!res.ok) throw new Error("Upload failed");
            const data = await res.json();
            attachments.push(data);
            renderAttachments();
            appendConsole(`Attached successfully: ${data.name}`, "ok");
          } catch (err) {
            appendConsole(`Failed to upload ${file.name}`, "error");
          }
        }
        e.target.value = "";
      }

      function renderAttachments() {
        const wrap = document.getElementById("attachment-chips");
        wrap.innerHTML = attachments
          .map(
            (a) => `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
          <span>📎 ${escapeHtml(a.name)}</span>
          <button type="button" onclick="removeAttachment('${a.id}')" class="text-zinc-500 hover:text-zinc-200">×</button>
        </div>
      `,
          )
          .join("");
      }

      window.removeAttachment = function (id) {
        attachments = attachments.filter((a) => a.id !== id);
        renderAttachments();
      };

      async function checkHealth() {
        try {
          const res = await fetch("/api/studio/health");
          const data = await res.json();
          if (data.ok) {
            document.getElementById("vm-dot").className =
              "w-1.5 h-1.5 rounded-full bg-emerald-500";
            document.getElementById("vm-status-text").textContent =
              "VM live · CLI ready";
          }
        } catch {
          document.getElementById("vm-dot").className =
            "w-1.5 h-1.5 rounded-full bg-rose-500";
          document.getElementById("vm-status-text").textContent = "VM offline";
        }
      }
      checkHealth();

      async function handleSend() {
        const promptInput = document.getElementById("prompt-input");
        const prompt = promptInput.value.trim();
        if (!prompt || isRunning) return;

        isRunning = true;
        promptInput.value = "";
        promptInput.style.height = "auto";
        document.getElementById("btn-send").disabled = true;

        appendConsole(`>>> Prompt submitted: "${prompt}"`, "ok");

        try {
          const res = await fetch("/api/studio/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              model: document.getElementById("model-select").value,
              attachments,
            }),
          });

          if (!res.ok || !res.body)
            throw new Error("Generation request failed");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";

            for (const block of parts) {
              for (const line of block.split("\n")) {
                if (!line.startsWith("data:")) continue;
                try {
                  const evt = JSON.parse(line.slice(5).trim());
                  if (evt.type === "log") {
                    appendConsole(evt.message, evt.level);
                  } else if (evt.type === "cli") {
                    appendConsole(evt.line, "cli");
                  } else if (evt.type === "reasoning") {
                    appendConsole(evt.line, "reason");
                  } else if (evt.type === "proof") {
                    appendConsole(
                      `[QA Proof] ${evt.name}: ${evt.passed ? "PASSED" : "FAILED"}`,
                      evt.passed ? "ok" : "warn",
                    );
                  } else if (evt.type === "usage") {
                    const m = evt.models?.[0];
                    if (m) {
                      document.getElementById("cli-token-badge").textContent =
                        `Tokens: ${m.input_tokens} in / ${m.output_tokens} out`;
                    }
                  } else if (evt.type === "done" && evt.ok) {
                    currentPlayUrl = evt.playUrl;
                    document.getElementById("game-frame").src =
                      evt.playUrl + "?t=" + Date.now();
                    document.getElementById("preview-title-bar").textContent =
                      evt.title;
                    appendConsole(
                      `SUCCESS! Playable game loaded: ${evt.title}`,
                      "ok",
                    );
                    refreshLibrary();
                  }
                } catch {}
              }
            }
          }
        } catch (err) {
          appendConsole(
            `Error during agent execution: ${err.message}`,
            "error",
          );
        } finally {
          isRunning = false;
          document.getElementById("btn-send").disabled = false;
        }
      }

      async function refreshLibrary() {
        try {
          const res = await fetch("/api/studio/games");
          const games = await res.json();
          document.getElementById("lib-count").textContent = games.length;
          const container = document.getElementById("games-list-container");
          if (!games.length) {
            container.innerHTML =
              '<p class="text-zinc-500 py-4 text-center">No stored games yet.</p>';
            return;
          }
          container.innerHTML = games
            .map(
              (g) => `
          <div class="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <div class="font-semibold text-zinc-200">${escapeHtml(g.title)}</div>
              <div class="text-[10px] text-zinc-500">${escapeHtml(g.prompt)}</div>
            </div>
            <button onclick="loadGame('${g.playUrl}', '${escapeHtml(g.title)}')" class="px-3 py-1 bg-brand-500 text-zinc-950 font-semibold rounded text-xs">Play</button>
          </div>
        `,
            )
            .join("");
        } catch {}
      }
      refreshLibrary();

      window.loadGame = function (url, title) {
        currentPlayUrl = url;
        document.getElementById("game-frame").src = url;
        document.getElementById("preview-title-bar").textContent = title;
        closeLibraryModal();
      };

      function openLibraryModal() {
        refreshLibrary();
        document.getElementById("modal-library").classList.remove("hidden");
        document.getElementById("modal-library").classList.add("flex");
      }
      function closeLibraryModal() {
        document.getElementById("modal-library").classList.add("hidden");
        document.getElementById("modal-library").classList.remove("flex");
      }
      function openQrDialog() {
        const u = currentPlayUrl
          ? window.location.origin + currentPlayUrl
          : window.location.origin + "/game";
        document.getElementById("qr-image").src =
          "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
          encodeURIComponent(u);
        document.getElementById("modal-qr").classList.remove("hidden");
        document.getElementById("modal-qr").classList.add("flex");
      }
      function closeMobileQrModal() {
        document.getElementById("modal-qr").classList.add("hidden");
        document.getElementById("modal-qr").classList.remove("flex");
      }
      function copyShareUrl() {
        const u = currentPlayUrl
          ? window.origin + currentPlayUrl
          : window.origin + "/game";
        copyText(u).then(() => alert("Link copied!"));
      }
      function reloadPreview() {
        const f = document.getElementById("game-frame");
        f.src = f.src;
      }
      function toggleFullscreen() {
        const f = document.getElementById("game-frame");
        if (f.requestFullscreen) f.requestFullscreen();
      }