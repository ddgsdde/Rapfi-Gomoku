export class RapfiEngine {
  worker = null;
  readiness = null;
  requests = new Map();
  nextId = 0;

  ready() {
    if (this.readiness) return this.readiness;
    let worker;
    try {
      worker = new Worker(new URL("./engine/worker.js", import.meta.url));
    } catch (error) {
      return Promise.reject(error);
    }
    this.worker = worker;
    this.readiness = new Promise((resolve, reject) => {
      const fail = (error) => {
        worker.terminate();
        this.worker = null;
        this.readiness = null;
        reject(error);
        for (const request of this.requests.values()) request.reject(error);
        this.requests.clear();
      };
      worker.onerror = (event) => fail(new Error(event.message || "Rapfi worker stopped."));
      worker.onmessage = ({ data }) => {
        if (data.startupError) fail(new Error(data.startupError));
        else if (data.ready) resolve();
        else {
          const request = this.requests.get(data.id);
          if (!request) return;
          this.requests.delete(data.id);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data.result);
        }
      };
    });
    return this.readiness;
  }

  async send(command) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...command });
    });
  }

  find(moves, level, excluded, renju) {
    return this.send({ type: "search", moves, level, excluded, renju });
  }

  evaluate(moves, renju) {
    return this.send({ type: "evaluate", moves, renju });
  }

  forbidden(moves) {
    return this.send({ type: "forbidden", moves, renju: true });
  }

  validateRenju(moves) {
    return this.send({ type: "validate-renju", moves, renju: true });
  }
}
