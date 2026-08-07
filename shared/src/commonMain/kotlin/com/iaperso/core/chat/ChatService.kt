package com.iaperso.core.chat

import com.iaperso.core.engine.LocalAIEngine
import com.iaperso.core.engine.PromptMessage
import com.iaperso.core.model.ChatMessage
import com.iaperso.core.model.Conversation
import com.iaperso.core.model.GenerationSettings
import com.iaperso.core.model.MessageRole
import com.iaperso.core.repository.ConversationRepository

class ChatService(
    private val engine: LocalAIEngine,
    private val conversations: ConversationRepository,
    private val idProvider: () -> String,
    private val nowMillis: () -> Long,
) {
    suspend fun createConversation(
        title: String = DEFAULT_TITLE,
        modelId: String? = null,
        systemPrompt: String? = null,
    ): Conversation {
        val now = nowMillis()
        val conversation = Conversation(
            id = idProvider(),
            title = title,
            modelId = modelId,
            systemPrompt = systemPrompt,
            createdAtEpochMillis = now,
            updatedAtEpochMillis = now,
        )
        conversations.save(conversation)
        return conversation
    }

    suspend fun sendMessage(
        conversationId: String,
        text: String,
        settings: GenerationSettings = GenerationSettings(),
        onAssistantDelta: (String) -> Unit = {},
    ): Result<Conversation> {
        val cleanText = text.trim()
        if (cleanText.isEmpty()) {
            return Result.failure(IllegalArgumentException("Message cannot be empty"))
        }

        val conversation = conversations.get(conversationId)
            ?: return Result.failure(IllegalArgumentException("Unknown conversation: $conversationId"))

        val now = nowMillis()
        val userMessage = ChatMessage(
            id = idProvider(),
            role = MessageRole.USER,
            text = cleanText,
            createdAtEpochMillis = now,
        )
        val withUser = conversation.copy(
            title = conversation.title.autoTitleIfNeeded(cleanText, conversation.messages.isEmpty()),
            messages = conversation.messages + userMessage,
            updatedAtEpochMillis = now,
        )
        conversations.save(withUser)

        val history = conversation.messages
            .filter { it.role != MessageRole.SYSTEM }
            .map { message ->
                PromptMessage(
                    role = when (message.role) {
                        MessageRole.USER -> "user"
                        MessageRole.ASSISTANT -> "assistant"
                        MessageRole.SYSTEM -> "system"
                    },
                    content = message.text,
                )
            }

        val assistantText = StringBuilder()
        val generation = engine.generateText(
            systemPrompt = conversation.systemPrompt,
            history = history,
            userPrompt = cleanText,
            settings = settings,
            onToken = { delta ->
                assistantText.append(delta)
                onAssistantDelta(delta)
            },
        )

        return generation.map {
            val completedAt = nowMillis()
            val assistantMessage = ChatMessage(
                id = idProvider(),
                role = MessageRole.ASSISTANT,
                text = assistantText.toString(),
                createdAtEpochMillis = completedAt,
            )
            val completed = withUser.copy(
                messages = withUser.messages + assistantMessage,
                updatedAtEpochMillis = completedAt,
            )
            conversations.save(completed)
            completed
        }
    }

    fun cancelGeneration() {
        engine.cancelTextGeneration()
    }

    private fun String.autoTitleIfNeeded(firstMessage: String, isFirstMessage: Boolean): String {
        if (!isFirstMessage || this != DEFAULT_TITLE) return this
        val oneLine = firstMessage.replace('\n', ' ').trim()
        return if (oneLine.length <= TITLE_MAX_LENGTH) oneLine else oneLine.take(TITLE_MAX_LENGTH - 1) + "…"
    }

    private companion object {
        const val DEFAULT_TITLE = "Nouvelle conversation"
        const val TITLE_MAX_LENGTH = 48
    }
}
