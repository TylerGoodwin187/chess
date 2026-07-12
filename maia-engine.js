// Simplified port of src/lib/engine/maia.ts (React-free)

class MaiaEngine {
  constructor({ modelUrl = "./maia3/maia3_simplified.onnx", modelVersion = "3", onStatus = () => {}, onProgress = () => {} } = {}) {
    this.worker = new Worker("./maia-worker.js");
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.pending = new Map();
    this.nextId = 0;
    this.status = "loading";

    this.readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    this.worker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case "status":
          this.status = msg.status;
          this.onStatus(msg.status);
          if (msg.status === "ready") this._resolveReady();
          if (msg.status === "no-cache" && !this._downloadTriggered) {
            // No cached model in IndexedDB — this is the only case where we actually download.
            this._downloadTriggered = true;
            this.worker.postMessage({ type: "download" });
          }
          break;
        case "progress":
          this.onProgress(msg.progress);
          break;
        case "error":
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id).reject(new Error(msg.message));
            this.pending.delete(msg.id);
          } else {
            console.error("Maia error:", msg.message);
            this._rejectReady(new Error(msg.message));
          }
          break;
        case "inference-result": {
          const p = this.pending.get(msg.id);
          if (p) {
            p.resolve({
              logitsMove: new Float32Array(msg.logitsMove),
              logitsValue: new Float32Array(msg.logitsValue),
            });
            this.pending.delete(msg.id);
          }
          break;
        }
      }
    };

    this.worker.onerror = (err) => {
      console.error("Maia worker crashed:", err);
      this._rejectReady(new Error(err.message || "Worker crashed"));
    };

    this.worker.postMessage({ type: "init", modelUrl, modelVersion });
  }

  // Waits until the model is ready to run inference. Uses the cached copy in
  // IndexedDB if one exists (see maia-worker.js) — only downloads on a true cache miss.
  async load() {
    return this.readyPromise;
  }

  _runInference(tokens, eloSelfs, eloOppos, batchSize) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        { type: "inference", id, tokens: tokens.buffer, eloSelfs: eloSelfs.buffer, eloOppos: eloOppos.buffer, batchSize },
        [tokens.buffer, eloSelfs.buffer, eloOppos.buffer]
      );
    });
  }

  // chessObj: chess.js instance at the position to evaluate. Returns { policy, value }
  // policy = { "e2e4": 0.31, ... } sorted by probability descending
  async evaluate(chessObj, eloSelf = 1500, eloOppo = 1500) {
    const fen = chessObj.fen();
    const { boardTokens, legalMoves } = MaiaTensor.preprocessMaia3(chessObj);
    const { logitsMove, logitsValue } = await this._runInference(
      boardTokens,
      Float32Array.from([eloSelf]),
      Float32Array.from([eloOppo]),
      1
    );
    return MaiaTensor.processOutputsMaia3(fen, logitsMove, logitsValue, legalMoves);
  }

  // Convenience: just get Maia's single chosen move in UCI form, e.g. "e2e4"
  async getMove(chessObj, eloSelf = 1500, eloOppo = 1500) {
    const { policy } = await this.evaluate(chessObj, eloSelf, eloOppo);
    return Object.keys(policy)[0]; // highest probability move
  }
}

window.MaiaEngine = MaiaEngine;
