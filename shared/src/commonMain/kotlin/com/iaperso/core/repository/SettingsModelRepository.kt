package com.iaperso.core.repository

import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.ModelCapability
import com.iaperso.core.model.ModelState
import com.russhwolf.settings.Settings
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

class SettingsModelRepository(
    private val settings: Settings = Settings(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    },
) : ModelRepository {

    override suspend fun list(capability: ModelCapability?): List<LocalModel> =
        readAll().filter { capability == null || it.capability == capability }

    override suspend fun get(id: String): LocalModel? =
        readAll().firstOrNull { it.id == id }

    override suspend fun upsert(model: LocalModel) {
        val current = readAll().associateBy { it.id }.toMutableMap()
        current[model.id] = model
        writeAll(current.values.toList())
    }

    override suspend fun remove(id: String) {
        writeAll(readAll().filterNot { it.id == id })
        ModelCapability.entries.forEach { capability ->
            if (activeId(capability) == id) setActiveModel(capability, null)
        }
    }

    override suspend fun activeModel(capability: ModelCapability): LocalModel? =
        activeId(capability)?.let { get(it) }

    override suspend fun setActiveModel(capability: ModelCapability, modelId: String?) {
        if (modelId != null) {
            val model = requireNotNull(get(modelId)) { "Unknown model: $modelId" }
            require(model.capability == capability) {
                "Model $modelId does not provide capability $capability"
            }
        }
        settings.putString(activeKey(capability), modelId.orEmpty())
        normalizeReadyState(capability, modelId)
    }

    private fun normalizeReadyState(capability: ModelCapability, activeId: String?) {
        val normalized = readAll().map { model ->
            if (model.capability != capability) {
                model
            } else {
                when {
                    model.id == activeId -> model.copy(state = ModelState.READY, errorMessage = null)
                    model.state == ModelState.READY -> model.copy(state = ModelState.INSTALLED)
                    else -> model
                }
            }
        }
        writeAll(normalized)
    }

    private fun activeId(capability: ModelCapability): String? =
        settings.getString(activeKey(capability), "").takeIf { it.isNotBlank() }

    private fun readAll(): List<LocalModel> {
        val raw = settings.getString(MODELS_KEY, "")
        if (raw.isBlank()) return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(LocalModel.serializer()), raw)
        }.getOrDefault(emptyList())
    }

    private fun writeAll(models: List<LocalModel>) {
        settings.putString(
            MODELS_KEY,
            json.encodeToString(ListSerializer(LocalModel.serializer()), models),
        )
    }

    private fun activeKey(capability: ModelCapability) =
        "ia_perso.active_model.${capability.name.lowercase()}"

    private companion object {
        const val MODELS_KEY = "ia_perso.models.v1"
    }
}
