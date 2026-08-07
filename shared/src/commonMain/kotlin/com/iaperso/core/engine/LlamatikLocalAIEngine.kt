package com.iaperso.core.engine

import com.iaperso.core.model.GenerationSettings
import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.ModelCapability
import com.llamatik.library.platform.LlamaBridge
import com.llamatik.library.platform.StableDiffusionBridge
import com.llamatik.library.platform.WhisperBridge
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

class LlamatikLocalAIEngine : LocalAIEngine {
    override var loadedTextModel: LocalModel? = null
        private set

    override var loadedImageModel: LocalModel? = null
        private set

    override var loadedSpeechModel: LocalModel? = null
        private set

    override suspend fun loadTextModel(
        model: LocalModel,
        settings: GenerationSettings,
    ): Result<Unit> = runCatching {
        require(model.capability == ModelCapability.TEXT_GENERATION) {
            "Model ${model.id} is not a text-generation model"
        }

        applyTextSettings(settings)
        if (loadedTextModel?.id == model.id) return@runCatching
        if (loadedTextModel != null) {
            LlamaBridge.shutdown()
            loadedTextModel = null
        }

        val modelPath = model.localPath ?: LlamaBridge.getModelPath(model.fileName)
        check(LlamaBridge.initGenerateModel(modelPath)) {
            "Unable to load text model: ${model.displayName}"
        }
        loadedTextModel = model.copy(localPath = modelPath)
    }

    override suspend fun loadImageModel(
        model: LocalModel,
        threads: Int,
    ): Result<Unit> = runCatching {
        require(model.capability == ModelCapability.IMAGE_GENERATION) {
            "Model ${model.id} is not an image-generation model"
        }

        if (loadedImageModel?.id == model.id) return@runCatching
        if (loadedImageModel != null) {
            StableDiffusionBridge.release()
            loadedImageModel = null
        }

        val modelPath = model.localPath ?: StableDiffusionBridge.getModelPath(model.fileName)
        check(StableDiffusionBridge.initModel(modelPath, threads)) {
            "Unable to load image model: ${model.displayName}"
        }
        loadedImageModel = model.copy(localPath = modelPath)
    }

    override suspend fun loadSpeechModel(model: LocalModel): Result<Unit> = runCatching {
        require(model.capability == ModelCapability.SPEECH_TO_TEXT) {
            "Model ${model.id} is not a speech-to-text model"
        }

        if (loadedSpeechModel?.id == model.id) return@runCatching
        if (loadedSpeechModel != null) {
            WhisperBridge.release()
            loadedSpeechModel = null
        }

        val modelPath = model.localPath ?: WhisperBridge.getModelPath(model.fileName)
        check(WhisperBridge.initModel(modelPath)) {
            "Unable to load speech model: ${model.displayName}"
        }
        loadedSpeechModel = model.copy(localPath = modelPath)
    }

    override suspend fun unloadTextModel() {
        LlamaBridge.shutdown()
        loadedTextModel = null
    }

    override suspend fun unloadImageModel() {
        StableDiffusionBridge.release()
        loadedImageModel = null
    }

    override suspend fun unloadSpeechModel() {
        WhisperBridge.release()
        loadedSpeechModel = null
    }

    override suspend fun generateText(
        systemPrompt: String?,
        history: List<PromptMessage>,
        userPrompt: String,
        settings: GenerationSettings,
        onToken: (String) -> Unit,
    ): Result<Unit> {
        if (loadedTextModel == null) {
            return Result.failure(IllegalStateException("No text model is loaded"))
        }

        applyTextSettings(settings)
        val context = history.joinToString(separator = "\n") { message ->
            "${message.role}: ${message.content}"
        }

        return suspendCoroutine { continuation ->
            LlamaBridge.generateWithContextStream(
                system = systemPrompt.orEmpty(),
                context = context,
                user = userPrompt,
                onDelta = onToken,
                onDone = { continuation.resume(Result.success(Unit)) },
                onError = { message ->
                    continuation.resume(Result.failure(IllegalStateException(message)))
                },
            )
        }
    }

    override fun cancelTextGeneration() {
        LlamaBridge.nativeCancelGenerate()
    }

    override suspend fun transcribeAudio(
        audioPath: String,
        language: String?,
    ): Result<TranscriptionResult> = runCatching {
        check(loadedSpeechModel != null) { "No speech model is loaded" }
        val text = WhisperBridge.transcribeWav(
            wavPath = audioPath,
            language = language,
            initialPrompt = null,
        )
        TranscriptionResult(text = text, language = language)
    }

    override suspend fun generateImage(
        prompt: String,
        negativePrompt: String?,
        settings: ImageGenerationSettings,
    ): Result<GeneratedImage> = runCatching {
        check(loadedImageModel != null) { "No image model is loaded" }
        val bytes = StableDiffusionBridge.txt2img(
            prompt = prompt,
            negativePrompt = negativePrompt,
            width = settings.width,
            height = settings.height,
            steps = settings.steps,
            cfgScale = settings.guidanceScale,
            seed = settings.seed,
        )
        check(bytes.isNotEmpty()) { "Image generation failed" }
        GeneratedImage(
            rgbaBytes = bytes,
            width = settings.width,
            height = settings.height,
            seed = settings.seed.takeIf { it >= 0 },
        )
    }

    override suspend fun shutdown() {
        LlamaBridge.shutdown()
        StableDiffusionBridge.release()
        WhisperBridge.release()
        loadedTextModel = null
        loadedImageModel = null
        loadedSpeechModel = null
    }

    private fun applyTextSettings(settings: GenerationSettings) {
        LlamaBridge.updateGenerateParams(
            temperature = settings.temperature,
            maxTokens = settings.maxTokens,
            topP = settings.topP,
            topK = settings.topK,
            repeatPenalty = settings.repeatPenalty,
            contextLength = settings.contextLength,
            numThreads = settings.threads,
            useMmap = settings.useMmap,
            flashAttention = settings.flashAttention,
            batchSize = settings.batchSize,
            gpuLayers = settings.gpuLayers,
        )
    }
}
