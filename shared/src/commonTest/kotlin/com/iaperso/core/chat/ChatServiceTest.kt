package com.iaperso.core.chat

import com.iaperso.core.engine.GeneratedImage
import com.iaperso.core.engine.ImageGenerationSettings
import com.iaperso.core.engine.LocalAIEngine
import com.iaperso.core.engine.PromptMessage
import com.iaperso.core.engine.TranscriptionResult
import com.iaperso.core.model.GenerationSettings
import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.MessageRole
import com.iaperso.core.repository.InMemoryConversationRepository
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ChatServiceTest {
    @Test
    fun sendMessagePersistsUserAndAssistantMessages() = runTest {
        val repository = InMemoryConversationRepository()
        val engine = FakeLocalAIEngine(response = "Bonjour depuis IA Perso")
        var nextId = 0
        var now = 1_000L
        val service = ChatService(
            engine = engine,
            conversations = repository,
            idProvider = { "id-${nextId++}" },
            nowMillis = { now++ },
        )

        val conversation = service.createConversation(title = "Test")
        val result = service.sendMessage(
            conversationId = conversation.id,
            text = "Bonjour",
        )

        assertTrue(result.isSuccess)
        val saved = repository.get(conversation.id)
        assertNotNull(saved)
        assertEquals(2, saved.messages.size)
        assertEquals(MessageRole.USER, saved.messages[0].role)
        assertEquals("Bonjour", saved.messages[0].text)
        assertEquals(MessageRole.ASSISTANT, saved.messages[1].role)
        assertEquals("Bonjour depuis IA Perso", saved.messages[1].text)
    }

    @Test
    fun sendMessageStreamsAssistantDeltas() = runTest {
        val repository = InMemoryConversationRepository()
        val engine = FakeLocalAIEngine(response = "ABC")
        var nextId = 0
        val service = ChatService(
            engine = engine,
            conversations = repository,
            idProvider = { "id-${nextId++}" },
            nowMillis = { 1_000L },
        )
        val conversation = service.createConversation()
        val streamed = StringBuilder()

        service.sendMessage(
            conversationId = conversation.id,
            text = "test",
            onAssistantDelta = { streamed.append(it) },
        )

        assertEquals("ABC", streamed.toString())
    }

    @Test
    fun firstMessageAutomaticallyNamesDefaultConversation() = runTest {
        val repository = InMemoryConversationRepository()
        val engine = FakeLocalAIEngine(response = "OK")
        var nextId = 0
        val service = ChatService(
            engine = engine,
            conversations = repository,
            idProvider = { "id-${nextId++}" },
            nowMillis = { 1_000L },
        )
        val conversation = service.createConversation()

        service.sendMessage(
            conversationId = conversation.id,
            text = "Explique-moi simplement comment fonctionne un modèle local",
        )

        val saved = repository.get(conversation.id)
        assertNotNull(saved)
        assertTrue(saved.title.startsWith("Explique-moi simplement"))
        assertTrue(saved.title.length <= 48)
    }
}

private class FakeLocalAIEngine(
    private val response: String,
) : LocalAIEngine {
    override var loadedTextModel: LocalModel? = null
        private set
    override var loadedImageModel: LocalModel? = null
        private set
    override var loadedSpeechModel: LocalModel? = null
        private set

    override suspend fun loadTextModel(model: LocalModel, settings: GenerationSettings): Result<Unit> {
        loadedTextModel = model
        return Result.success(Unit)
    }

    override suspend fun loadImageModel(model: LocalModel, threads: Int): Result<Unit> {
        loadedImageModel = model
        return Result.success(Unit)
    }

    override suspend fun loadSpeechModel(model: LocalModel): Result<Unit> {
        loadedSpeechModel = model
        return Result.success(Unit)
    }

    override suspend fun unloadTextModel() {
        loadedTextModel = null
    }

    override suspend fun unloadImageModel() {
        loadedImageModel = null
    }

    override suspend fun unloadSpeechModel() {
        loadedSpeechModel = null
    }

    override suspend fun generateText(
        systemPrompt: String?,
        history: List<PromptMessage>,
        userPrompt: String,
        settings: GenerationSettings,
        onToken: (String) -> Unit,
    ): Result<Unit> {
        response.forEach { onToken(it.toString()) }
        return Result.success(Unit)
    }

    override fun cancelTextGeneration() = Unit

    override suspend fun transcribeAudio(audioPath: String, language: String?): Result<TranscriptionResult> =
        Result.success(TranscriptionResult(text = ""))

    override suspend fun generateImage(
        prompt: String,
        negativePrompt: String?,
        settings: ImageGenerationSettings,
    ): Result<GeneratedImage> = Result.failure(UnsupportedOperationException())

    override suspend fun shutdown() = Unit
}
