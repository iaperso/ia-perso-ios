package com.iaperso.core.model

enum class MessageRole {
    SYSTEM,
    USER,
    ASSISTANT,
}

enum class MessageModality {
    TEXT,
    IMAGE,
    AUDIO,
}

data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String,
    val createdAtEpochMillis: Long,
    val modality: MessageModality = MessageModality.TEXT,
    val localAssetPath: String? = null,
)

data class Conversation(
    val id: String,
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val modelId: String? = null,
    val systemPrompt: String? = null,
    val createdAtEpochMillis: Long,
    val updatedAtEpochMillis: Long,
)
