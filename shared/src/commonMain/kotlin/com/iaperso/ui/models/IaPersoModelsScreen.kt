package com.iaperso.ui.models

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.iaperso.core.model.LocalModel
import com.iaperso.core.model.ModelCapability
import com.iaperso.core.model.ModelState

@Composable
fun IaPersoModelsScreen(
    models: List<LocalModel>,
    onBack: () -> Unit,
    onImport: (ModelCapability) -> Unit,
    onLoad: (LocalModel) -> Unit,
    onRemove: (LocalModel) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Modèles locaux") },
                navigationIcon = {
                    Button(onClick = onBack) { Text("Retour") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Les modèles restent sur ton appareil. Aucun abonnement IA n'est requis.",
                style = MaterialTheme.typography.bodyMedium,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = { onImport(ModelCapability.TEXT_GENERATION) }) {
                    Text("Importer GGUF")
                }
                Button(onClick = { onImport(ModelCapability.IMAGE_GENERATION) }) {
                    Text("Importer image")
                }
                Button(onClick = { onImport(ModelCapability.SPEECH_TO_TEXT) }) {
                    Text("Importer Whisper")
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (models.isEmpty()) {
                    item {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text("Aucun modèle importé", style = MaterialTheme.typography.titleMedium)
                                Text("Commence par un petit modèle texte GGUF adapté à l’iPhone.")
                            }
                        }
                    }
                }

                items(models, key = { it.id }) { model ->
                    ModelCard(model, onLoad, onRemove)
                }
            }
        }
    }
}

@Composable
private fun ModelCard(
    model: LocalModel,
    onLoad: (LocalModel) -> Unit,
    onRemove: (LocalModel) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(model.displayName, style = MaterialTheme.typography.titleMedium)
            Text(capabilityLabel(model.capability))
            Text(model.fileName, style = MaterialTheme.typography.bodySmall)
            Text("État : ${stateLabel(model.state)}")
            model.errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (model.state == ModelState.INSTALLED || model.state == ModelState.ERROR) {
                    Button(onClick = { onLoad(model) }) { Text("Charger") }
                }
                if (model.localPath != null) {
                    Button(onClick = { onRemove(model) }) { Text("Retirer") }
                }
            }
        }
    }
}

private fun capabilityLabel(capability: ModelCapability): String = when (capability) {
    ModelCapability.TEXT_GENERATION -> "Texte"
    ModelCapability.IMAGE_GENERATION -> "Images"
    ModelCapability.SPEECH_TO_TEXT -> "Voix → texte"
}

private fun stateLabel(state: ModelState): String = when (state) {
    ModelState.NOT_INSTALLED -> "non installé"
    ModelState.DOWNLOADING -> "téléchargement"
    ModelState.INSTALLED -> "installé"
    ModelState.LOADING -> "chargement"
    ModelState.READY -> "prêt"
    ModelState.ERROR -> "erreur"
}
