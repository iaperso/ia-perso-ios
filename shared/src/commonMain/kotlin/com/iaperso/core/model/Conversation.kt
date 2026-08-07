package com.iaperso.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class MessageRole {
    SYSTEM,
    USER,
    ASSISTANT,
}

@Serializable
enum class MessageModality {
    TEXT,
    IMAGE,
    AUDIO,
}

@Serializable
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String,
    val createdAtEpochMillis: Long,
    val modality: MessageModality = MessageModality.TEXT,
    val localAssetPath: String? = null,
)

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val modelId: String? = null,
    val systemPrompt: String? = null,
    val createdAtEpochMillis: Long,
    val updatedAtEpochMillis: Long,
)
