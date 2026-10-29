(function () {
        "use strict";

        // Backend base. Served from the same origin in production; overridable for the
        // Vercel-hosted UI which talks to the VM backend directly.
        var API = window.STUDIO_API_BASE || "";

        var el = function (id) {
          return document.getElementById(id);
        };

        // NOTE: no predefined step list. Steps are created live, in order,
        // from the agent's own phase events (see handleEvent "phase").
        // Whatever the VM agent actually does is what appears here.
        var stepNodes = {};

        function createStepNode(id, label, source) {
          var node = document.createElement("div");
          node.className = "step";
          node.dataset.status = "running";
          node.innerHTML =
            '<div class="step-dot"></div>' +
            '<div class="step-body">' +
            '<div class="step-title"></div>' +
            '<div class="step-detail"></div>' +
            "</div>";
          node.querySelector(".step-title").textContent = label || id;
          if (source) node.title = source;
          el("pipe").appendChild(node);
          stepNodes[id] = {
            root: node,
            detail: node.querySelector(".step-detail"),
            source: source || "",
          };
          return stepNodes[id];
        }

        function resetPipeline() {
          el("pipe").innerHTML = "";
          stepNodes = {};
        }

        // ---------- Console ----------
        function timestamp() {
          var d = new Date();
          return (
            String(d.getHours()).padStart(2, "0") +
            ":" +
            String(d.getMinutes()).padStart(2, "0") +
            ":" +
            String(d.getSeconds()).padStart(2, "0")
          );
        }

        function appendLine(level, message) {
          var consoleEl = el("console");
          var empty = consoleEl.querySelector(".empty");
          if (empty) empty.remove();

          var row = document.createElement("div");
          row.className = "row";
          row.dataset.l = level;
          var ts = document.createElement("span");
          ts.className = "ts";
          ts.textContent = timestamp();
          var msg = document.createElement("span");
          msg.className = "msg";
          msg.textContent = message;
          row.appendChild(ts);
          row.appendChild(msg);
          consoleEl.appendChild(row);

          var nearBottom =
            consoleEl.scrollHeight -
              consoleEl.scrollTop -
              consoleEl.clientHeight <
            90;
          if (nearBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
        }

        function setStatus(text, state) {
          var tag = el("status-tag");
          tag.textContent = text;
          tag.dataset.s = state;
        }

        // ---------- Backend health ----------
        function checkHealth() {
          fetch(API + "/api/studio/health")
            .then(function (r) {
              return r.ok ? r.json() : Promise.reject();
            })
            .then(function (data) {
              var c = data.components || {};
              el("backend-status").textContent = "backend ok";
              el("backend-status").style.color = "var(--ok)";
              el("backend-status").title =
                "muse CLI: " +
                (c.museCodeCLI ? "present" : "absent") +
                " · engines: " +
                (c.engines || []).join(", ");
            })
            .catch(function () {
              el("backend-status").textContent = "backend offline";
              el("backend-status").style.color = "var(--err)";
            });
        }

        // ---------- Elapsed clock ----------
        function startClock() {
          startedAt = Date.now();
          stopClock();
          timerId = setInterval(function () {
            el("stat-elapsed").textContent =
              ((Date.now() - startedAt) / 1000).toFixed(1) + "s";
          }, 100);
        }
        function stopClock() {
          if (timerId) {
            clearInterval(timerId);
            timerId = null;
          }
        }

        // ---------- Events ----------
        function handleEvent(evt) {
          eventCount++;
          el("stat-events").textContent = String(eventCount);

          switch (evt.type) {
            case "start":
              appendLine("info", 'Run started for: "' + evt.prompt + '"');
              break;

            case "phase": {
              // Steps panel shows ONLY the CLI agent's own actions
              // (origin "cli"). Backend orchestration becomes console lines.
              if (evt.origin === "cli") {
                var node = stepNodes[evt.id];
                if (!node) {
                  node = createStepNode(evt.id, evt.label, evt.source);
                }
                node.root.dataset.status = evt.status;
                var detailText = evt.detail || "";
                if (node.source && detailText)
                  detailText = "[" + node.source + "] " + detailText;
                else if (node.source) detailText = node.source;
                node.detail.textContent = detailText;
                if (evt.status === "running")
                  appendLine("info", "→ " + (evt.label || evt.id));
              } else if (evt.status === "running") {
                appendLine("info", "→ " + (evt.label || evt.id));
              }
              break;
            }

            case "log":
              appendLine(evt.level || "info", evt.message);
              break;

            case "cli":
              appendLine(
                "cli",
                (evt.stream === "stderr" ? "! " : "$ ") + evt.line,
              );
              break;

            case "reasoning":
              appendLine("reason", "· " + evt.line);
              break;

            case "proof":
              appendLine(
                evt.passed ? "ok" : "warn",
                "[proof] " +
                  evt.name +
                  " — " +
                  (evt.passed ? "PASSED" : "FAILED"),
              );
              el("stat-qa").textContent = evt.passed ? "passed" : "check";
              break;

            case "usage": {
              var totals = { in: 0, out: 0, cached: 0 };
              (evt.models || []).forEach(function (m) {
                totals.in += m.input_tokens || 0;
                totals.out += m.output_tokens || 0;
                totals.cached += m.cached_tokens || 0;
              });
              appendLine(
                "info",
                "CLI tokens this run: " +
                  totals.in +
                  " in / " +
                  totals.out +
                  " out (" +
                  totals.cached +
                  " cached)",
              );
              break;
            }

            case "error":
              appendLine("error", evt.message);
              break;

            case "done":
              stopClock();
              if (evt.ok && evt.playUrl) {
                appendLine(
                  "ok",
                  'Game ready: "' +
                    evt.title +
                    '" in ' +
                    (evt.elapsedMs / 1000).toFixed(1) +
                    "s",
                );
                loadGame(evt.playUrl, evt.title);
                setStatus("done", "done");
                el("stat-qa").textContent = "100%";
                refreshLibrary();
              } else {
                appendLine("error", "Run finished without a playable build.");
                setStatus("failed", "error");
              }
              finishRun();
              break;
          }
        }

        function loadGame(url, title) {
          el("placeholder").style.display = "none";
          el("frame").src = API + url + "?t=" + Date.now();
          el("preview-title").textContent = title || "Project Preview";
          el("live-dot").dataset.on = "1";
        }

        function finishRun() {
          running = false;
          el("btn-run").disabled = false;
          el("btn-stop").disabled = true;
        }

        function readStream(response) {
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";

          function pump() {
            return reader.read().then(function (result) {
              if (result.done) return;
              buffer += decoder.decode(result.value, { stream: true });

              var parts = buffer.split("\n\n");
              buffer = parts.pop();

              parts.forEach(function (block) {
                block.split("\n").forEach(function (line) {
                  if (!line.startsWith("data:")) return;
                  var payload = line.slice(5).trim();
                  if (!payload) return;
                  try {
                    handleEvent(JSON.parse(payload));
                  } catch (e) {
                    /* ignore malformed frame */
                  }
                });
              });

              return pump();
            });
          }
          return pump();
        }

        // ---------- Run ----------
        function run() {
          if (running) return;
          var prompt = el("prompt").value.trim();
          if (!prompt) return;

          running = true;
          eventCount = 0;
          el("stat-events").textContent = "0";
          el("stat-qa").textContent = "—";
          el("preview-title").textContent = "Project Preview";
          el("live-dot").dataset.on = "0";
          el("console").innerHTML = "";
          resetPipeline();
          setStatus("running", "running");
          el("btn-run").disabled = true;
          el("btn-stop").disabled = false;
          startClock();

          var controller = new AbortController();
          el("btn-stop").onclick = function () {
            controller.abort();
            appendLine("warn", "Run cancelled by user.");
            setStatus("cancelled", "error");
            stopClock();
            finishRun();
          };

          fetch(API + "/api/studio/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: prompt }),
            signal: controller.signal,
          })
            .then(function (response) {
              if (!response.ok)
                throw new Error("Bad response: " + response.status);
              if (!response.body)
                throw new Error("Streaming unsupported by this browser.");
              return readStream(response);
            })
            .catch(function (err) {
              if (err && err.name === "AbortError") return;
              appendLine(
                "error",
                "Connection failed. Is the studio backend running?",
              );
              setStatus("error", "error");
              stopClock();
              finishRun();
            });
        }

        // ---------- Library ----------
        function refreshLibrary() {
          fetch(API + "/api/studio/games")
            .then(function (r) {
              return r.ok ? r.json() : [];
            })
            .then(function (games) {
              el("lib-count").textContent = String(games.length);
              renderLibrary(games);
            })
            .catch(function () {
              el("lib-count").textContent = "0";
            });
        }

        function renderLibrary(games) {
          var body = el("modal-body");
          body.innerHTML = "";

          if (!games || games.length === 0) {
            var empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent =
              "No stored games yet. Run the agent to create one.";
            body.appendChild(empty);
            return;
          }

          games.forEach(function (game) {
            var card = document.createElement("div");
            card.className = "game-card";

            var meta = document.createElement("div");
            meta.className = "game-meta";

            var title = document.createElement("div");
            title.className = "game-title";
            title.textContent = game.title;

            var tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = game.biome || "world";
            title.appendChild(tag);

            var promptLine = document.createElement("div");
            promptLine.className = "game-prompt";
            promptLine.textContent = game.prompt || "";

            var time = document.createElement("div");
            time.className = "game-time";
            time.textContent = new Date(game.createdAt).toLocaleString();

            meta.appendChild(title);
            meta.appendChild(promptLine);
            meta.appendChild(time);

            var play = document.createElement("button");
            play.textContent = "Play";
            play.onclick = function () {
              loadGame(game.playUrl, game.title);
              closeModal();
            };

            card.appendChild(meta);
            card.appendChild(play);
            body.appendChild(card);
          });
        }

        function openModal() {
          el("modal").dataset.open = "1";
          refreshLibrary();
        }
        function closeModal() {
          el("modal").dataset.open = "0";
        }

        // ---------- Wire up ----------
        el("btn-run").onclick = run;
        el("btn-library").onclick = openModal;
        el("modal-close").onclick = closeModal;
        el("modal").onclick = function (e) {
          if (e.target === el("modal")) closeModal();
        };
        el("btn-reload").onclick = function () {
          var frame = el("frame");
          if (frame.src) frame.src = frame.src;
        };
        el("btn-fullscreen").onclick = function () {
          var frame = el("frame");
          if (frame.requestFullscreen) frame.requestFullscreen();
        };

        Array.prototype.forEach.call(
          document.querySelectorAll(".chip"),
          function (chip) {
            chip.onclick = function () {
              el("prompt").value = chip.dataset.p;
            };
          },
        );

        el("prompt").addEventListener("keydown", function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
        });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape") closeModal();
        });

        checkHealth();
        refreshLibrary();
      })();