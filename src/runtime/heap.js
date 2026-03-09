export class Heap {
  constructor({ youngLimit = 24, oldLimit = 256, incrementalBudget = 6 } = {}) {
    this.youngLimit = youngLimit;
    this.oldLimit = oldLimit;
    this.incrementalBudget = incrementalBudget;
    this.nextId = 1;
    this.young = new Map();
    this.old = new Map();
    this.markQueue = [];
    this.logs = [];
  }

  track(object, kind) {
    const tag = {
      id: this.nextId++,
      kind,
      age: 0,
      generation: "young",
      marked: false,
      object
    };
    this.young.set(tag.id, tag);
    this.logs.push(`alloc ${kind}#${tag.id} young`);
    return tag;
  }

  writeBarrier(value) {
    if (value?.heapTag && value.heapTag.generation === "young") {
      this.logs.push(`wb -> young object#${value.heapTag.id}`);
    }
  }

  maybeCollect(roots) {
    if (this.young.size >= this.youngLimit) {
      this.collectYoung(roots);
    }
    if (this.old.size >= this.oldLimit) {
      this.startIncrementalMark(roots);
    }
  }

  collectYoung(roots) {
    const live = this.markFromRoots(roots, { includeOld: false });
    for (const [id, tag] of this.young) {
      if (!live.has(id)) {
        this.young.delete(id);
        this.logs.push(`young sweep ${tag.kind}#${id}`);
        continue;
      }
      tag.age += 1;
      if (tag.age >= 2) {
        tag.generation = "old";
        this.old.set(id, tag);
        this.young.delete(id);
        this.logs.push(`promote ${tag.kind}#${id} old`);
      }
    }
  }

  startIncrementalMark(roots) {
    this.markQueue = [...roots];
    this.logs.push("gc incremental-mark start");
    this.incrementalMark();
  }

  incrementalMark() {
    let budget = this.incrementalBudget;
    while (budget > 0 && this.markQueue.length > 0) {
      const candidate = this.markQueue.shift();
      if (!candidate?.heapTag) {
        budget -= 1;
        continue;
      }
      const tag = candidate.heapTag;
      if (tag.marked) {
        budget -= 1;
        continue;
      }
      tag.marked = true;
      const refs = typeof candidate.references === "function" ? candidate.references() : [];
      this.markQueue.push(...refs);
      budget -= 1;
    }
    if (this.markQueue.length === 0) {
      for (const [id, tag] of this.old) {
        if (!tag.marked) {
          this.old.delete(id);
          this.logs.push(`old sweep ${tag.kind}#${id}`);
          continue;
        }
        tag.marked = false;
      }
      this.logs.push("gc incremental-mark done");
    }
  }

  markFromRoots(roots, { includeOld }) {
    const live = new Set();
    const queue = [...roots];
    while (queue.length > 0) {
      const value = queue.shift();
      if (!value?.heapTag) {
        continue;
      }
      const tag = value.heapTag;
      if (!includeOld && tag.generation === "old") {
        continue;
      }
      if (live.has(tag.id)) {
        continue;
      }
      live.add(tag.id);
      const refs = typeof value.references === "function" ? value.references() : [];
      queue.push(...refs);
    }
    return live;
  }
}
