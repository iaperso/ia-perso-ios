package com.iaperso.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import com.iaperso.core.audio.LocalAudioPicker
import com.iaperso.core.chat.ChatService
import com.iaperso.core.engine.ImageGenerationSettings
import com.iaperso.core.engine.LlamatikLocalAIEngine
import com.iaperso.core.model.Conversation
import com.iaperso.core.model.GenerationSettings
import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.ModelCapability
import com.iaperso.core.model.ModelState
import com.iaperso.core.repository.SettingsConversationRepository
import com.iaperso.core.repository.SettingsModelRepository
import com.iaperso.ui.chat.IaPersoChatScreen
import com.iaperso.ui.chat.IaPersoChatUiState
import com.iaperso.ui.conversations.IaPersoConversationsScreen
import com.iaperso.ui.image.IaPersoImageScreen
import com.iaperso.ui.image.IaPersoImageUiState
import com.iaperso.ui.image.rgbaToPreviewImageBitmap
import com.iaperso.ui.models.IaPersoModelsScreen
import com.iaperso.ui.voice.IaPersoVoiceScreen
import com.iaperso.ui.voice.IaPersoVoiceUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock
import kotlin.random.Random

@Composable
fun IaPersoRoot(
    importLocalModel: suspend (ModelCapability) -> LocalModel?,
    removeLocalModelFile: (LocalModel) -> Result<Unit>,
) {
    val scope = rememberCoroutineScope()
    val conversationsRepository = remember { SettingsConversationRepository() }
    val modelsRepository = remember { SettingsModelRepository() }
    val engine = remember { LlamatikLocalAIEngine() }
    val chatService = remember {
        ChatService(
            engine = engine,
            conversations = conversationsRepository,
            idProvider = {
                "${Clock.System.now().toEpochMilliseconds()}-${Random.nextLong().toString(16)}"
            },
            nowMillis = { Clock.System.now().toEpochMilliseconds() },
        )
    }

    var route by remember { mutableStateOf(IaPersoRoute.CHAT) }
    var conversationList by remember { mutableStateOf<List<Conversation>>(emptyList()) }
    var currentConversation by remember { mutableStateOf<Conversation?>(null) }
    var models by remember { mutableStateOf<List<LocalModel>>(emptyList()) }
    var activeTextModel by remember { mutableStateOf<LocalModel?>(null) }
    var activeImageModel by remember { mutableStateOf<LocalModel?>(null) }
    var activeSpeechModel by remember { mutableStateOf<LocalModel?>(null) }
    var isGenerating by remember { mutableStateOf(false) }
    var streamingText by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isGeneratingImage by remember { mutableStateOf(false) }
    var imagePreview by remember { mutableStateOf<ImageBitmap?>(null) }
    var generatedImageWidth by remember { mutableStateOf(0) }
    var generatedImageHeight by remember { mutableStateOf(0) }
    var imageErrorMessage by remember { mutableStateOf<String?>(null) }
    var isTranscribing by remember { mutableStateOf(false) }
    var transcript by remember { mutableStateOf("") }
    var voiceErrorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun refreshConversations() {
        conversationList = conversationsRepository.list()
        currentConversation?.let { current ->
            currentConversation = conversationsRepository.get(current.id)
        }
    }

    suspend fun refreshModels() {
        models = modelsRepository.list()
        activeTextModel = modelsRepository.activeModel(ModelCapability.TEXT_GENERATION)
        activeImageModel = modelsRepository.activeModel(ModelCapability.IMAGE_GENERATION)
        activeSpeechModel = modelsRepository.activeModel(ModelCapability.SPEECH_TO_TEXT)
    }

    suspend fun createNewConversation(): Conversation {
        val created = chatService.createConversation()
        currentConversation = created
        refreshConversations()
        return created
    }

    suspend fun ensureConversation(): Conversation {
        currentConversation?.let { return it }
        val existing = conversationsRepository.list().firstOrNull()
        if (existing != null) {
            currentConversation = existing
            return existing
        }
        return createNewConversation()
    }

    suspend fun releaseOtherEnginesFor(capability: ModelCapability) {
        withContext(Dispatchers.Default) {
            when (capability) {
                ModelCapability.TEXT_GENERATION -> {
                    if (engine.loadedImageModel != null) engine.unloadImageModel()
                    if (engine.loadedSpeechModel != null) engine.unloadSpeechModel()
                }
                ModelCapability.IMAGE_GENERATION -> {
                    if (engine.loadedTextModel != null) engine.unloadTextModel()
                    if (engine.loadedSpeechModel != null) engine.unloadSpeechModel()
                }
                ModelCapability.SPEECH_TO_TEXT -> {
                    if (engine.loadedTextModel != null) engine.unloadTextModel()
                    if (engine.loadedImageModel != null) engine.unloadImageModel()
                }
            }
        }
    }

    suspend fun loadModel(model: LocalModel) {
        errorMessage = null
        imageErrorMessage = null
        voiceErrorMessage = null

        val previousActive = modelsRepository.activeModel(model.capability)
        if (previousActive?.id != model.id) {
            modelsRepository.setActiveModel(model.capability, null)
            previousActive?.let { previous ->
                modelsRepository.upsert(
                    previous.copy(state = ModelState.INSTALLED, errorMessage = null),
                )
            }
        }

        val loading = model.copy(state = ModelState.LOADING, errorMessage = null)
        modelsRepository.upsert(loading)
        refreshModels()

        releaseOtherEnginesFor(model.capability)
        val result = withContext(Dispatchers.Default) {
            when (model.capability) {
                ModelCapability.TEXT_GENERATION -> engine.loadTextModel(model)
                ModelCapability.IMAGE_GENERATION -> engine.loadImageModel(model)
                ModelCapability.SPEECH_TO_TEXT -> engine.loadSpeechModel(model)
            }
        }

        result.onSuccess {
            val ready = model.copy(state = ModelState.READY, errorMessage = null)
            modelsRepository.upsert(ready)
            modelsRepository.setActiveModel(model.capability, model.id)
        }.onFailure { failure ->
            modelsRepository.upsert(
                model.copy(
                    state = ModelState.ERROR,
                    errorMessage = failure.message ?: "Impossible de charger le modèle",
                ),
            )
            errorMessage = failure.message
            imageErrorMessage = failure.message
            voiceErrorMessage = failure.message
        }
        refreshModels()
    }

    suspend fun ensureTextModelLoaded(): Boolean {
        if (engine.loadedTextModel != null) return true
        val saved = activeTextModel ?: modelsRepository.activeModel(ModelCapability.TEXT_GENERATION)
        if (saved?.localPath == null) return false
        loadModel(saved)
        return engine.loadedTextModel != null
    }

    suspend fun ensureImageModelLoaded(): Boolean {
        if (engine.loadedImageModel != null) return true
        val saved = activeImageModel ?: modelsRepository.activeModel(ModelCapability.IMAGE_GENERATION)
        if (saved?.localPath == null) return false
        loadModel(saved)
        return engine.loadedImageModel != null
    }

    suspend fun ensureSpeechModelLoaded(): Boolean {
        if (engine.loadedSpeechModel != null) return true
        val saved = activeSpeechModel ?: modelsRepository.activeModel(ModelCapability.SPEECH_TO_TEXT)
        if (saved?.localPath == null) return false
        loadModel(saved)
        return engine.loadedSpeechModel != null
    }

    suspend fun returnToChat() {
        if (activeTextModel != null) {
            ensureTextModelLoaded()
        }
        route = IaPersoRoute.CHAT
    }

    LaunchedEffect(Unit) {
        conversationList = conversationsRepository.list()
        currentConversation = conversationList.firstOrNull()
        refreshModels()

        activeTextModel?.let { saved ->
            if (saved.localPath != null) {
                val result = withContext(Dispatchers.Default) { engine.loadTextModel(saved) }
                if (result.isFailure) {
                    modelsRepository.setActiveModel(ModelCapability.TEXT_GENERATION, null)
                    modelsRepository.upsert(
                        saved.copy(
                            state = ModelState.ERROR,
                            errorMessage = result.exceptionOrNull()?.message ?: "Impossible de recharger le modèle",
                        ),
                    )
                    errorMessage = result.exceptionOrNull()?.message
                    refreshModels()
                }
            }
        }
    }

    when (route) {
        IaPersoRoute.CHAT -> {
            IaPersoChatScreen(
                state = IaPersoChatUiState(
                    messages = currentConversation?.messages.orEmpty(),
                    activeModelName = activeTextModel?.displayName,
                    isGenerating = isGenerating,
                    streamingText = streamingText,
                    errorMessage = errorMessage,
                ),
                onSend = { text ->
                    scope.launch {
                        errorMessage = null
                        if (!ensureTextModelLoaded()) {
                            errorMessage = "Charge d’abord un modèle texte dans Modèles."
                            return@launch
                        }
                        isGenerating = true
                        streamingText = ""
                        val conversation = ensureConversation()
                        val result = chatService.sendMessage(
                            conversationId = conversation.id,
                            text = text,
                            settings = GenerationSettings(),
                            onAssistantDelta = { delta -> streamingText += delta },
                        )
                        result.onSuccess { completed ->
                            currentConversation = completed
                            streamingText = ""
                            refreshConversations()
                        }.onFailure { failure ->
                            errorMessage = failure.message ?: "La génération a échoué"
                            currentConversation = conversationsRepository.get(conversation.id)
                            refreshConversations()
                        }
                        isGenerating = false
                    }
                },
                onCancel = {
                    chatService.cancelGeneration()
                    isGenerating = false
                },
                onOpenConversations = {
                    scope.launch {
                        refreshConversations()
                        route = IaPersoRoute.CONVERSATIONS
                    }
                },
                onOpenImages = {
                    scope.launch {
                        imageErrorMessage = null
                        ensureImageModelLoaded()
                        route = IaPersoRoute.IMAGES
                    }
                },
                onOpenVoice = {
                    scope.launch {
                        voiceErrorMessage = null
                        ensureSpeechModelLoaded()
                        route = IaPersoRoute.VOICE
                    }
                },
                onOpenModels = { route = IaPersoRoute.MODELS },
            )
        }

        IaPersoRoute.CONVERSATIONS -> {
            IaPersoConversationsScreen(
                conversations = conversationList,
                currentConversationId = currentConversation?.id,
                onBack = { route = IaPersoRoute.CHAT },
                onNewConversation = {
                    scope.launch {
                        createNewConversation()
                        route = IaPersoRoute.CHAT
                    }
                },
                onOpenConversation = { conversation ->
                    currentConversation = conversation
                    errorMessage = null
                    streamingText = ""
                    route = IaPersoRoute.CHAT
                },
                onDeleteConversation = { conversation ->
                    scope.launch {
                        conversationsRepository.delete(conversation.id)
                        if (currentConversation?.id == conversation.id) {
                            currentConversation = null
                        }
                        refreshConversations()
                    }
                },
            )
        }

        IaPersoRoute.IMAGES -> {
            IaPersoImageScreen(
                state = IaPersoImageUiState(
                    activeModelName = engine.loadedImageModel?.displayName,
                    isGenerating = isGeneratingImage,
                    preview = imagePreview,
                    width = generatedImageWidth,
                    height = generatedImageHeight,
                    errorMessage = imageErrorMessage,
                ),
                onBack = { scope.launch { returnToChat() } },
                onOpenModels = { route = IaPersoRoute.MODELS },
                onGenerate = { prompt, negativePrompt ->
                    scope.launch {
                        imageErrorMessage = null
                        if (!ensureImageModelLoaded()) {
                            imageErrorMessage = "Charge d’abord un modèle image dans Modèles."
                            return@launch
                        }
                        isGeneratingImage = true
                        val result = withContext(Dispatchers.Default) {
                            engine.generateImage(
                                prompt = prompt,
                                negativePrompt = negativePrompt,
                                settings = ImageGenerationSettings(),
                            )
                        }
                        result.onSuccess { generated ->
                            generatedImageWidth = generated.width
                            generatedImageHeight = generated.height
                            imagePreview = withContext(Dispatchers.Default) {
                                rgbaToPreviewImageBitmap(
                                    rgba = generated.rgbaBytes,
                                    width = generated.width,
                                    height = generated.height,
                                )
                            }
                        }.onFailure { failure ->
                            imageErrorMessage = failure.message ?: "La génération d’image a échoué"
                        }
                        isGeneratingImage = false
                    }
                },
            )
        }

        IaPersoRoute.VOICE -> {
            IaPersoVoiceScreen(
                state = IaPersoVoiceUiState(
                    activeModelName = engine.loadedSpeechModel?.displayName,
                    isTranscribing = isTranscribing,
                    transcript = transcript,
                    errorMessage = voiceErrorMessage,
                ),
                onBack = { scope.launch { returnToChat() } },
                onOpenModels = { route = IaPersoRoute.MODELS },
                onPickAndTranscribe = {
                    scope.launch {
                        voiceErrorMessage = null
                        if (!ensureSpeechModelLoaded()) {
                            voiceErrorMessage = "Charge d’abord un modèle Whisper dans Modèles."
                            return@launch
                        }
                        val audioPath = LocalAudioPicker.pickWhisperWav() ?: return@launch
                        isTranscribing = true
                        val result = withContext(Dispatchers.Default) {
                            engine.transcribeAudio(audioPath)
                        }
                        result.onSuccess { transcription ->
                            transcript = transcription.text
                        }.onFailure { failure ->
                            voiceErrorMessage = failure.message ?: "La transcription a échoué"
                        }
                        withContext(Dispatchers.Default) {
                            LocalAudioPicker.cleanup(audioPath)
                        }
                        isTranscribing = false
                    }
                },
            )
        }

        IaPersoRoute.MODELS -> {
            IaPersoModelsScreen(
                models = models,
                onBack = { scope.launch { returnToChat() } },
                onImport = { capability ->
                    scope.launch {
                        errorMessage = null
                        imageErrorMessage = null
                        voiceErrorMessage = null
                        val imported = importLocalModel(capability)
                        if (imported != null) {
                            modelsRepository.upsert(
                                imported.copy(state = ModelState.INSTALLED, errorMessage = null),
                            )
                            refreshModels()
                        }
                    }
                },
                onLoad = { model -> scope.launch { loadModel(model) } },
                onRemove = { model ->
                    scope.launch {
                        errorMessage = null
                        val unloadResult = runCatching {
                            withContext(Dispatchers.Default) {
                                when (model.capability) {
                                    ModelCapability.TEXT_GENERATION -> {
                                        if (engine.loadedTextModel?.id == model.id) engine.unloadTextModel()
                                    }
                                    ModelCapability.IMAGE_GENERATION -> {
                                        if (engine.loadedImageModel?.id == model.id) engine.unloadImageModel()
                                    }
                                    ModelCapability.SPEECH_TO_TEXT -> {
                                        if (engine.loadedSpeechModel?.id == model.id) engine.unloadSpeechModel()
                                    }
                                }
                            }
                        }
                        if (unloadResult.isFailure) {
                            errorMessage = unloadResult.exceptionOrNull()?.message ?: "Impossible de libérer le modèle"
                            return@launch
                        }

                        val deleteResult = withContext(Dispatchers.Default) {
                            removeLocalModelFile(model)
                        }
                        if (deleteResult.isFailure) {
                            errorMessage = deleteResult.exceptionOrNull()?.message ?: "Impossible de supprimer le fichier du modèle"
                            return@launch
                        }

                        modelsRepository.remove(model.id)
                        refreshModels()
                    }
                },
            )
        }
    }
}

private enum class IaPersoRoute {
    CHAT,
    CONVERSATIONS,
    IMAGES,
    VOICE,
    MODELS,
}
