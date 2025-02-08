<?php
header('Content-Type: application/json');

// Funzione per ottenere tutti i file audio ricorsivamente
function getAudioFiles($dir = '.') {
    $audioFiles = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $file) {
        if ($file->isFile() && in_array($file->getExtension(), ['mp3', 'wav', 'ogg', 'm4a'])) {
            $audioFiles[] = $file->getPathname();
        }
    }
    return $audioFiles;
}

// Ottieni i file audio e restituisci come JSON
$audioFiles = getAudioFiles();
echo json_encode($audioFiles);
?>