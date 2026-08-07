package com.iaperso.core.repository

import com.iaperso.core.model.Conversation

interface ConversationRepository {
    suspend fun list(): List<Conversation>
    suspend fun get(id: String): Conversation?
    suspend fun save(conversation: Conversation)
    suspend fun delete(id: String)
}

class InMemoryConversationRepository : ConversationRepository {
    private val conversations = linkedMapOf<String, Conversation>()

    override suspend fun list(): List<Conversation> =
        conversations.values.sortedByDescending { it.updatedAtEpochMillis }

    override suspend fun get(id: String): Conversation? = conversations[id]

    override suspend fun save(conversation: Conversation) {
        conversations[conversation.id] = conversation
    }

    override suspend fun delete(id: String) {
        conversations.remove(id)
    }
}
