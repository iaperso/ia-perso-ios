package com.iaperso.ui.image

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp

@Composable
fun IaPersoImageScreen(
    state: IaPersoImageUiState,
    onBack: () -> Unit,
    onOpenModels: () -> Unit,
    onGenerate: (prompt: String, negativePrompt: String?) -> Unit,
) {
    var prompt by remember { mutableStateOf("") }
    var negativePrompt by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Images locales") },
                navigationIcon = {
                    Button(onClick = onBack) { Text("Retour") }
                },
                actions = {
                    Button(onClick = onOpenModels) { Text("Modèles") }
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
            if (state.activeModelName == null) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("Aucun modèle image chargé", style = MaterialTheme.typography.titleMedium)
                        Text("Importe puis charge un modèle compatible dans Modèles.")
                    }
                }
            } else {
                Text("Modèle : ${state.activeModelName}")
            }

            OutlinedTextField(
                value = prompt,
                onValueChange = { prompt = it },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isGenerating,
                label = { Text("Décris l’image") },
                placeholder = { Text("Ex. un petit robot dans une forêt, lumière douce") },
            )

            OutlinedTextField(
                value = negativePrompt,
                onValueChange = { negativePrompt = it },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isGenerating,
                label = { Text("À éviter (facultatif)") },
            )

            Button(
                onClick = {
                    onGenerate(prompt.trim(), negativePrompt.trim().takeIf { it.isNotEmpty() })
                },
                enabled = state.activeModelName != null && prompt.isNotBlank() && !state.isGenerating,
            ) {
                if (state.isGenerating) {
                    CircularProgressIndicator()
                    Text("Génération…")
                } else {
                    Text("Générer sur l’iPhone")
                }
            }

            state.errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            state.preview?.let { preview ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Image(
                            bitmap = preview,
                            contentDescription = "Image générée localement",
                            modifier = Modifier
                                .fillMaxWidth()
                                .sizeIn(maxHeight = 420.dp),
                            contentScale = ContentScale.Fit,
                        )
                        Text(
                            "Image calculée localement · ${state.width}×${state.height}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

data class IaPersoImageUiState(
    val activeModelName: String? = null,
    val isGenerating: Boolean = false,
    val preview: ImageBitmap? = null,
    val width: Int = 0,
    val height: Int = 0,
    val errorMessage: String? = null,
)
