package com.iaperso.ui.voice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun IaPersoVoiceScreen(
    state: IaPersoVoiceUiState,
    onBack: () -> Unit,
    onOpenModels: () -> Unit,
    onStartRecording: () -> Unit,
    onStopAndTranscribe: () -> Unit,
    onPickAndTranscribe: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Voix locale") },
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
                .padding(12.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.activeModelName == null) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("Aucun modèle Whisper chargé", style = MaterialTheme.typography.titleMedium)
                        Text("Importe puis charge un modèle Whisper dans Modèles.")
                    }
                }
            } else {
                Text("Modèle : ${state.activeModelName}")
            }

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Parler à IA Perso", style = MaterialTheme.typography.titleMedium)
                    Text("L’enregistrement et la transcription restent sur l’iPhone.")

                    if (state.isRecording) {
                        Text("Enregistrement en cours…")
                        Button(onClick = onStopAndTranscribe) {
                            Text("Arrêter et transcrire")
                        }
                    } else {
                        Button(
                            onClick = onStartRecording,
                            enabled = state.activeModelName != null && !state.isTranscribing,
                        ) {
                            Text("Commencer l’enregistrement")
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onPickAndTranscribe,
                    enabled = state.activeModelName != null && !state.isTranscribing && !state.isRecording,
                ) {
                    Text("Transcrire un WAV")
                }
            }

            if (state.isTranscribing) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator()
                    Text("Transcription locale en cours…")
                }
            }

            state.errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            if (state.transcript.isNotBlank()) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("Transcription", style = MaterialTheme.typography.titleMedium)
                        Text(state.transcript)
                    }
                }
            }
        }
    }
}

data class IaPersoVoiceUiState(
    val activeModelName: String? = null,
    val isRecording: Boolean = false,
    val isTranscribing: Boolean = false,
    val transcript: String = "",
    val errorMessage: String? = null,
)
