package com.iaperso.core.repository

import com.iaperso.core.model.ChatMessage
import com.iaperso.core.model.Conversation
import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.MessageRole
import com.iaperso.core.model.ModelCapability
import com.iaperso.core.model.ModelState
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SettingsRepositoriesTest {
    @Test
    fun conversationRepositoryPersistsAndSortsNewestFirst() = runTest {
        val settings = MapSettings()
        val repository = SettingsConversationRepository(settings = settings)

        repository.save(
            Conversation(
                id = "old",
                title = "Ancienne",
                messages = listOf(
                    ChatMessage(
                        id = "m1",
                        role = MessageRole.USER,
                        text = "Bonjour",
                        createdAtEpochMillis = 1,
                    ),
                ),
                createdAtEpochMillis = 1,
                updatedAtEpochMillis = 10,
            ),
        )
        repository.save(
            Conversation(
                id = "new",
                title = "Récente",
                createdAtEpochMillis = 2,
                updatedAtEpochMillis = 20,
            ),
        )

        val reloaded = SettingsConversationRepository(settings = settings)
        val conversations = reloaded.list()

        assertEquals(listOf("new", "old"), conversations.map { it.id })
        assertEquals("Bonjour", reloaded.get("old")?.messages?.single()?.text)
    }

    @Test
    fun modelRepositoryKeepsOnlyOneReadyModelPerCapability() = runTest {
        val settings = MapSettings()
        val repository = SettingsModelRepository(settings = settings)
        val first = textModel("first")
        val second = textModel("second")
        repository.upsert(first)
        repository.upsert(second)

        repository.setActiveModel(ModelCapability.TEXT_GENERATION, first.id)
        assertEquals(ModelState.READY, repository.get(first.id)?.state)
        assertEquals(ModelState.INSTALLED, repository.get(second.id)?.state)

        repository.setActiveModel(ModelCapability.TEXT_GENERATION, second.id)
        assertEquals(ModelState.INSTALLED, repository.get(first.id)?.state)
        assertEquals(ModelState.READY, repository.get(second.id)?.state)
        assertEquals(second.id, repository.activeModel(ModelCapability.TEXT_GENERATION)?.id)

        repository.remove(second.id)
        assertNull(repository.activeModel(ModelCapability.TEXT_GENERATION))
        assertEquals(ModelState.INSTALLED, repository.get(first.id)?.state)
    }

    private fun textModel(id: String) = LocalModel(
        id = id,
        displayName = id,
        fileName = "$id.gguf",
        capability = ModelCapability.TEXT_GENERATION,
        localPath = "/tmp/$id.gguf",
        state = ModelState.INSTALLED,
    )
}
