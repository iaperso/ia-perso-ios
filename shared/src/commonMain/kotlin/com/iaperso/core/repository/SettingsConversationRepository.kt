package com.iaperso.core.repository

import com.iaperso.core.model.Conversation
import com.russhwolf.settings.Settings
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Small local persistence layer backed by Multiplatform Settings.
 *
 * This is intentionally simple for the first usable IA Perso version: all conversation
 * metadata/messages are stored as JSON in the application's local key-value storage.
 * Large generated assets stay on disk and are referenced by local path from ChatMessage.
 */
class SettingsConversationRepository(
    private val settings: Settings = Settings(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    },
) : ConversationRepository {

    override suspend fun list(): List<Conversation> = readAll()
        .sortedByDescending { it.updatedAtEpochMillis }

    override suspend fun get(id: String): Conversation? =
        readAll().firstOrNull { it.id == id }

    override suspend fun save(conversation: Conversation) {
        val current = readAll().associateBy { it.id }.toMutableMap()
        current[conversation.id] = conversation
        writeAll(current.values.toList())
    }

    override suspend fun delete(id: String) {
        writeAll(readAll().filterNot { it.id == id })
    }

    private fun readAll(): List<Conversation> {
        val raw = settings.getString(STORAGE_KEY, "")
        if (raw.isBlank()) return emptyList()

        return runCatching {
            json.decodeFromString(ListSerializer(Conversation.serializer()), raw)
        }.getOrDefault(emptyList())
    }

    private fun writeAll(conversations: List<Conversation>) {
        val raw = json.encodeToString(ListSerializer(Conversation.serializer()), conversations)
        settings.putString(STORAGE_KEY, raw)
    }

    private companion object {
        const val STORAGE_KEY = "ia_perso.conversations.v1"
    }
}
