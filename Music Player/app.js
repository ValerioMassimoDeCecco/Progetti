document.addEventListener('DOMContentLoaded', () => {
    const AudioPlayer = (() => {
        let currentAudio = new Audio();
        let currentTrack = 0;
        let audioFiles = [];
        let isShuffle = false;
        let isDragging = false;

        const elements = {
            audioList: document.getElementById('audioList'),
            playerContainer: document.getElementById('playerContainer'),
            playButton: document.getElementById('playButton'),
            shuffleButton: document.getElementById('shuffleButton'),
            currentTime: document.getElementById('currentTime'),
            duration: document.getElementById('duration'),
            progressBar: document.getElementById('progressBar'),
            progressContainer: document.getElementById('progressContainer')
        };

        // Inizializzazione
        const init = () => {
            setupEventListeners();
            loadAudioFiles();
            checkAudioSupport();
        };

        const setupEventListeners = () => {
            elements.playButton.addEventListener('click', togglePlay);
            document.getElementById('shuffleButton').addEventListener('click', toggleShuffle);
            document.querySelector('[data-action="prev"]').addEventListener('click', previousTrack);
            document.querySelector('[data-action="next"]').addEventListener('click', nextTrack);
            
            elements.progressContainer.addEventListener('click', seek);
            elements.progressContainer.addEventListener('touchstart', startDrag);
            elements.progressContainer.addEventListener('touchmove', drag);
            elements.progressContainer.addEventListener('touchend', endDrag);
            
            currentAudio.addEventListener('timeupdate', updateProgress);
            currentAudio.addEventListener('loadedmetadata', updateDuration);
            currentAudio.addEventListener('ended', nextTrack);
            currentAudio.addEventListener('error', handleAudioError);
            currentAudio.addEventListener('waiting', showBuffering);
            currentAudio.addEventListener('playing', hideBuffering);
            
            window.addEventListener('resize', handleMobileLayout);
        };

        // Resto del codice con le funzioni modificate...
        // Implementa tutte le funzionalità richieste qui...
        
        return {
            init
        };
    })();

    AudioPlayer.init();
});