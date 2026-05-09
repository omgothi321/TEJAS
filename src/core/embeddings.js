'use strict';

const path = require('path');
const fs = require('fs-extra');

class EmbeddingService {
  constructor(tejasDir) {
    this.cacheDir = path.join(tejasDir, 'models');
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
    this.pipeline = null;
  }

  async initialize() {
    const { pipeline, env } = await import('@xenova/transformers');
    
    // Configure cache directory
    env.cacheDir = this.cacheDir;
    await fs.ensureDir(this.cacheDir);

    this.pipeline = await pipeline('feature-extraction', this.modelName);
    return this;
  }

  async embed(text) {
    if (!this.pipeline) await this.initialize();
    
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  }

  static cosineSimilarity(v1, v2) {
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      mag1 += v1[i] * v1[i];
      mag2 += v2[i] * v2[i];
    }
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }
}

module.exports = EmbeddingService;
