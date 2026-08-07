package com.iaperso.core.engine

import com.iaperso.core.model.GenerationSettings
import com.iaperso.core.model.LocalModel

interface LocalAIEngine {
    val loadedTextModel: LocalModel?

    suspend fun loadTextModel(
        model: LocalModel,
        settings: GenerationSettings = GenerationSettings(),
    ): Result<Unit>

    suspend fun unloadTextModel()

    suspend fun generateText(
        systemPrompt: String?,
        history: List<PromptMessage>,
        userPrompt: String,
        settings: GenerationSettings = GenerationSettings(),
        onToken: (String) -> Unit,
    ): Result<Unit>

    fun cancelTextGeneration()

    suspend fun transcribeAudio(
        audioPath: String,
        language: String? = null,
    ): Result<TranscriptionResult>

    suspend fun generateImage(
        prompt: String,
        negativePrompt: String? = null,
        settings: ImageGenerationSettings = ImageGenerationSettings(),
    ): Result<GeneratedImage>

    suspend fun shutdown()
}

data class PromptMessage(
    val role: String,
    val content: String,
)

data class TranscriptionSegment(
    val text: String,
    val startMillis: Long,
    val endMillis: Long,
    val speakerTurnNext: Boolean = false,
)

data class TranscriptionResult(
    val text: String,
    val language: String? = null,
    val segments: List<TranscriptionSegment> = emptyList(),
)

data class ImageGenerationSettings(
    val width: Int = 512,
    val height: Int = 512,
    val steps: Int = 20,
    val seed: Long = -1,
    val guidanceScale: Float = 7.0f,
)

data class GeneratedImage(
    val localPath: String,
    val width: Int,
    val height: Int,
    val seed: Long? = null,
)
