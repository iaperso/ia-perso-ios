package com.iaperso.core.repository

import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.ModelCapability
import com.iaperso.core.model.ModelState

interface ModelRepository {
    suspend fun list(capability: ModelCapability? = null): List<LocalModel>
    suspend fun get(id: String): LocalModel?
    suspend fun upsert(model: LocalModel)
    suspend fun remove(id: String)
    suspend fun activeModel(capability: ModelCapability): LocalModel?
    suspend fun setActiveModel(capability: ModelCapability, modelId: String?)
}

class InMemoryModelRepository : ModelRepository {
    private val models = linkedMapOf<String, LocalModel>()
    private val active = mutableMapOf<ModelCapability, String>()

    override suspend fun list(capability: ModelCapability?): List<LocalModel> =
        models.values.filter { capability == null || it.capability == capability }

    override suspend fun get(id: String): LocalModel? = models[id]

    override suspend fun upsert(model: LocalModel) {
        models[model.id] = model
    }

    override suspend fun remove(id: String) {
        models.remove(id)
        active.entries.removeAll { it.value == id }
    }

    override suspend fun activeModel(capability: ModelCapability): LocalModel? =
        active[capability]?.let(models::get)

    override suspend fun setActiveModel(capability: ModelCapability, modelId: String?) {
        if (modelId == null) {
            active.remove(capability)
            normalizeReadyState(capability, null)
            return
        }
        val model = requireNotNull(models[modelId]) { "Unknown model: $modelId" }
        require(model.capability == capability) {
            "Model $modelId does not provide capability $capability"
        }
        active[capability] = modelId
        normalizeReadyState(capability, modelId)
    }

    private fun normalizeReadyState(capability: ModelCapability, activeId: String?) {
        models.entries.forEach { entry ->
            val model = entry.value
            if (model.capability != capability) return@forEach
            entry.setValue(
                when {
                    model.id == activeId -> model.copy(state = ModelState.READY, errorMessage = null)
                    model.state == ModelState.READY -> model.copy(state = ModelState.INSTALLED)
                    else -> model
                },
            )
        }
    }
}
