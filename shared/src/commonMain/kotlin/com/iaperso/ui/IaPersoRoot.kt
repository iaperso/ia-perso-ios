package com.iaperso.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.iaperso.core.chat.ChatService
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
import com.iaperso.ui.models.IaPersoModelsScreen
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlin.random.Random

/**
 * Self-contained IA Perso product root.
 *
 * Platform code only needs to provide a file importer. Everything else here is local:
 * conversations, selected models and inference state.
 */
@Composable
fun IaPersoRoot(
    importLocalModel: suspend (ModelCapability) -> LocalModel?,
) {
    val scope = rememberCoroutineScope()
    val conversations = remember { SettingsConversationRepository() }
    val modelsRepository = remember { SettingsModelRepository() }
    val engine = remember { LlamatikLocalAIEngine() }
    val chatService = remember {
        ChatService(
            engine = engine,
            conversations = conversations,
            idProvider = {
                "${Clock.System.now().toEpochMilliseconds()}-${Random.nextLong().toString(16)}"
            },
            nowMillis = { Clock.System.now().toEpochMilliseconds() },
        )
    }

    var route by remember { mutableStateOf(IaPersoRoute.CHAT) }
    var currentConversation by remember { mutableStateOf<Conversation?>(null) }
    var models by remember { mutableStateOf<List<LocalModel>>(emptyList()) }
    var activeTextModel by remember { mutableStateOf<LocalModel?>(null) }
    var isGenerating by remember { mutableStateOf(false) }
    var streamingText by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun refreshModels() {
        models = modelsRepository.list()
        activeTextModel = modelsRepository.activeModel(ModelCapability.TEXT_GENERATION)
    }

    suspend fun ensureConversation(): Conversation {
        currentConversation?.let { return it }
        val existing = conversations.list().firstOrNull()
        if (existing != null) {
            currentConversation = existing
            return existing
        }
        return chatService.createConversation().also { currentConversation = it }
    }

    suspend fun loadModel(model: LocalModel) {
        errorMessage = null
        val loading = model.copy(state = ModelState.LOADING, errorMessage = null)
        modelsRepository.upsert(loading)
        refreshModels()

        val result = when (model.capability) {
            ModelCapability.TEXT_GENERATION -> engine.loadTextModel(model)
            ModelCapability.IMAGE_GENERATION -> engine.loadImageModel(model)
            ModelCapability.SPEECH_TO_TEXT -> engine.loadSpeechModel(model)
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
        }
        refreshModels()
    }

    LaunchedEffect(Unit) {
        currentConversation = conversations.list().firstOrNull()
        refreshModels()

        activeTextModel?.let { saved ->
            if (saved.localPath != null) {
                val result = engine.loadTextModel(saved)
                if (result.isFailure) {
                    errorMessage = result.exceptionOrNull()?.message
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
                        }.onFailure { failure ->
                            errorMessage = failure.message ?: "La génération a échoué"
                            currentConversation = conversations.get(conversation.id)
                        }
                        isGenerating = false
                    }
                },
                onCancel = {
                    chatService.cancelGeneration()
                    isGenerating = false
                },
                onOpenModels = { route = IaPersoRoute.MODELS },
            )
        }

        IaPersoRoute.MODELS -> {
            IaPersoModelsScreen(
                models = models,
                onBack = { route = IaPersoRoute.CHAT },
                onImport = { capability ->
                    scope.launch {
                        errorMessage = null
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
                        when (model.capability) {
                            ModelCapability.TEXT_GENERATION -> engine.unloadTextModel()
                            ModelCapability.IMAGE_GENERATION -> engine.unloadImageModel()
                            ModelCapability.SPEECH_TO_TEXT -> engine.unloadSpeechModel()
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
    MODELS,
}
