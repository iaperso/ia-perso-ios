package com.iaperso.core.model

enum class ModelCapability {
    TEXT_GENERATION,
    IMAGE_GENERATION,
    SPEECH_TO_TEXT,
}

enum class ModelState {
    NOT_INSTALLED,
    DOWNLOADING,
    INSTALLED,
    LOADING,
    READY,
    ERROR,
}

data class LocalModel(
    val id: String,
    val displayName: String,
    val fileName: String,
    val capability: ModelCapability,
    val localPath: String? = null,
    val sizeBytes: Long? = null,
    val state: ModelState = ModelState.NOT_INSTALLED,
    val errorMessage: String? = null,
)

data class GenerationSettings(
    val temperature: Float = 0.7f,
    val topP: Float = 0.95f,
    val topK: Int = 40,
    val repeatPenalty: Float = 1.1f,
    val maxTokens: Int = 512,
    val contextLength: Int = 4096,
    val threads: Int = 4,
    val gpuLayers: Int = 0,
)
