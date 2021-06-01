import React, {useEffect, useState, useRef} from 'react'
import PropTypes from 'prop-types'
import {css} from 'aphrodite/no-important'
import BigScreen from 'isomorphic-bigscreen'
import {EVENTS, ACTIONS} from 'griffith-message'
import {ua} from 'griffith-utils'

import Time from '../Time'
import Icon from '../Icon'
import * as icons from '../Icon/icons/display'
import Loader from '../Loader'
import Video from '../Video'
import Controller from '../Controller'
import {MinimalTimeline} from '../Timeline'
import getBufferedTime from '../../utils/getBufferedTime'
import storage from '../../utils/storage'
import Pip from '../../utils/pip'
import {ObjectFitContext} from '../../contexts/ObjectFit'

import styles, {hiddenOrShownStyle} from './styles'

const CONTROLLER_HIDE_DELAY = 3000
const {isMobile} = ua

Player.propTypes = {
  standalone: PropTypes.bool,
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  title: PropTypes.string,
  cover: PropTypes.string,
  duration: PropTypes.number,
  progressDots: PropTypes.arrayOf(
    PropTypes.shape({
      startTime: PropTypes.number.isRequired,
    })
  ),
  onEvent: PropTypes.func.isRequired,
  onBeforePlay: PropTypes.func.isRequired,
  autoplay: PropTypes.bool,
  muted: PropTypes.bool,
  disablePictureInPicture: PropTypes.bool,
  hiddenPlayButton: PropTypes.bool,
  hiddenTimeline: PropTypes.bool,
  hiddenTime: PropTypes.bool,
  hiddenQualityMenu: PropTypes.bool,
  hiddenVolume: PropTypes.bool,
  hiddenFullScreenButton: PropTypes.bool,
}

Player.defaultProps = {
  standalone: false,
  duration: 0,
  autoplay: false,
  muted: false,
  disablePictureInPicture: false,
}

function Player(props) {
  const {
    autoplay,
    subscribeAction,
    muted,
    error,
    title,
    cover,
    standalone,
    onEvent,
    onBeforePlay,
    useMSE,
    useAutoQuality,
    disablePictureInPicture,
    progressDots,
    hiddenPlayButton,
    hiddenTimeline,
    hiddenTime,
    hiddenQualityMenu,
    hiddenVolume,
    hiddenFullScreenButton,
  } = props
  const [state, rawSetState] = useState(() => ({
    isPlaybackStarted: false, // 开始播放的时候设置为 true，播放中途暂停仍然为 true，直到播放到最后停止的时候才会变成 false，
    isNeverPlayed: true, // 用户第一次播放之后设置为 false，并且之后永远为 false
    lastAction: null,
    isDataLoaded: false,
    isPlaying: false,
    isLoading: false,
    duration: 0,
    currentTime: 0,
    volume: 0.5,
    buffered: [],
    isControllerShown: false,
    isControllerHovered: false,
    isControllerDragging: false,
    type: null,
    hovered: false,
    pressed: false,
  }))
  // TODO: 每个状态拆开更好
  const setState = partial => rawSetState(obj => ({...obj, ...partial}))
  // refs
  const isSeekingRef = useRef(false)
  const showLoaderTimeoutRef = useRef(null)
  const hideControllerTimeoutRef = useRef(null)
  const playerRef = useRef()
  const videoRef = useRef()

  // const getDerivedStateFromProps = (props, state) => {
  //   const {duration} = props

  //   const shouldUpdateDuration = duration && !state.duration
  //   const newDurationState = shouldUpdateDuration ? {duration} : null

  //   return {...newDurationState}
  // }

  useEffect(() => {
    initPip()

    const historyVolume = storage.get('@griffith/history-volume')
    if (historyVolume) {
      setState({volume: historyVolume})
    }

    const pauseActionSubscription = subscribeAction(
      ACTIONS.PLAYER.PAUSE,
      handlePauseAction
    )

    const timeUpdateActionSubscription = subscribeAction(
      ACTIONS.PLAYER.TIME_UPDATE,
      ({currentTime}) => handleSeek(currentTime)
    )

    if (videoRef.current.root) {
      if (muted) {
        handleVideoVolumeChange(0)
      }
      if (autoplay) {
        handlePlay('video')
      }
    }

    return () => {
      pauseActionSubscription.unsubscribe()
      timeUpdateActionSubscription.unsubscribe()
    }
  }, [])

  // componentDidUpdate() {
  //   this.initPip()
  // }

  useEffect(() => {
    if (standalone && typeof title === 'string' && title !== document.title) {
      document.title = title
    }
  }, [standalone, title])

  const initPip = () => {
    if (!disablePictureInPicture && videoRef.current.root && !Pip.inited) {
      Pip.init(
        videoRef.current.root,
        () => onEvent(EVENTS.PLAYER.ENTER_PIP),
        () => onEvent(EVENTS.PLAYER.EXIT_PIP)
      )
    }
  }

  const handlePauseAction = ({dontApplyOnFullScreen} = {}) => {
    if (!state.isPlaying) return

    if (dontApplyOnFullScreen && Boolean(BigScreen.element)) return

    handlePause('button') // 通过这种方式暂停不会显示中间的图标
  }

  const handleToggle = () => {
    if (state.isPlaying) {
      handlePause('video')
    } else {
      handlePlay('video')
    }
  }

  const handlePlay = (type = null) => {
    onEvent(EVENTS.PLAYER.REQUEST_PLAY)
    onBeforePlay()
      .then(() => {
        if (!state.isPlaybackStarted) {
          onEvent(EVENTS.PLAYER.PLAY_COUNT)
          setState({isPlaybackStarted: true})
          if (!state.isDataLoaded) {
            setState({isLoading: true})
          }
          // workaround a bug in IE about replaying a video.
          if (state.currentTime !== 0) {
            handleSeek(0)
          }
        } else {
          setState({lastAction: 'play'})
        }
        setState({isPlaying: true, type, isNeverPlayed: false})
      })
      .catch(() => {
        onEvent(EVENTS.PLAYER.PLAY_REJECTED)
        // 播放被取消
      })
  }

  const handlePause = (type = null) => {
    onEvent(EVENTS.PLAYER.REQUEST_PAUSE)
    const {isLoading} = state

    if (!isLoading) {
      setState({
        lastAction: 'pause',
        isPlaying: false,
        type,
      })
    }
  }

  const handleVideoPlay = () => {
    if (!state.isPlaying) {
      setState({isPlaying: true})
    }
  }

  const handleVideoPause = () => {
    if (state.isPlaying) {
      setState({isPlaying: false})
    }
  }

  const handleVideoEnded = () => {
    setState({
      isPlaybackStarted: false,
      lastAction: null,
      isPlaying: false,
      isLoading: false,
    })
  }

  const handleVideoLoadedData = () => {
    setState({
      isDataLoaded: true,
      isLoading: false,
    })
  }

  const handleVideoError = () => {
    setState({
      isPlaying: false,
      isLoading: false,
    })
  }

  const handleVideoDurationChange = duration => {
    setState({duration})
  }

  const handleVideoTimeUpdate = currentTime => {
    const {isLoading} = state
    if (isLoading || isSeekingRef.current) {
      return
    }
    setState({currentTime})
  }

  const handleVideoVolumeChange = volume => {
    volume = Math.round(volume * 100) / 100
    setState({volume})
    storage.set('@griffith/history-volume', volume)
  }

  const handleSeek = currentTime => {
    const {
      isPlaybackStarted,
      isNeverPlayed,
      currentTime: stateCurrentTime,
    } = state
    const isPlayEnded =
      !isPlaybackStarted && !isNeverPlayed && stateCurrentTime !== 0 // 播放结束，显示「重新播放」状态
    setState({currentTime})
    // TODO 想办法去掉这个实例方法调用
    videoRef.current.seek(currentTime)
    if (isPlayEnded) {
      handlePlay()
    }
  }

  const handleVideoWaiting = () => {
    if (showLoaderTimeoutRef.current !== null) return
    showLoaderTimeoutRef.current = setTimeout(() => {
      setState({isLoading: true})
    }, 1000)
  }

  const handleVideoPlaying = () => {
    if (showLoaderTimeoutRef.current !== null) {
      clearTimeout(showLoaderTimeoutRef.current)
      showLoaderTimeoutRef.current = null
    }
    setState({isLoading: false})
  }

  const handleVideoSeeking = () => {
    isSeekingRef.current = true
  }

  const handleVideoSeeked = () => {
    isSeekingRef.current = false
  }

  const handleVideoProgress = buffered => {
    setState({buffered})
  }

  const handleToggleFullScreen = () => {
    if (BigScreen.enabled) {
      const onEnter = () => {
        return onEvent(EVENTS.PLAYER.ENTER_FULLSCREEN)
      }
      const onExit = () => {
        return onEvent(EVENTS.PLAYER.EXIT_FULLSCREEN)
      }
      BigScreen.toggle(playerRef.current, onEnter, onExit)
    }
  }

  const handleTogglePip = () => {
    Pip.toggle()
  }

  const handleShowController = () => {
    if (!state.isControllerShown) {
      setState({isControllerShown: true})
    }
    if (hideControllerTimeoutRef.current !== null) {
      clearTimeout(hideControllerTimeoutRef.current)
    }
    hideControllerTimeoutRef.current = setTimeout(() => {
      hideControllerTimeoutRef.current = null
      setState({isControllerShown: false})
    }, CONTROLLER_HIDE_DELAY)
  }

  const handleHideController = () => {
    if (hideControllerTimeoutRef.current !== null) {
      clearTimeout(hideControllerTimeoutRef.current)
      hideControllerTimeoutRef.current = null
    }
    setState({isControllerShown: false})
  }

  const handleControllerPointerEnter = () => {
    setState({isControllerHovered: true})
  }

  const handleControllerPointerLeave = () => {
    setState({isControllerHovered: false})
  }

  const handleControllerDragStart = () => {
    setState({isControllerDragging: true})
  }

  const handleControllerDragEnd = () => {
    setState({isControllerDragging: false})
  }

  const handleMouseEnter = () => {
    setState({hovered: true})
    handleShowController()
  }

  const handleMouseLeave = () => {
    setState({hovered: false})
    handleHideController()
  }

  const handleMouseDown = () => {
    setState({pressed: true})
    handleShowController()
  }

  const handleMouseUp = () => {
    setState({pressed: false})
    handleShowController()
  }

  const {
    isPlaybackStarted,
    lastAction,
    isPlaying,
    isLoading,
    duration,
    isControllerShown,
    isControllerHovered,
    isControllerDragging,
    currentTime,
    isNeverPlayed,
    volume,
    buffered,
    type,
    hovered,
    pressed,
  } = state

  const isPip = Boolean(Pip.pictureInPictureElement)
  // Safari 会将 pip 状态视为全屏
  const isFullScreen = Boolean(BigScreen.element) && !isPip

  // 未播放时不展示 Controller
  // 播放中暂停时展示 Controller
  // 播放中 Controller shown/hovered/dragging 时展示 Controller
  // 播放结束展示 Controller
  const showController =
    (isPlaybackStarted &&
      (!isPlaying ||
        isControllerShown ||
        isControllerHovered ||
        isControllerDragging)) ||
    (!isPlaybackStarted && currentTime !== 0)

  const bufferedTime = getBufferedTime(currentTime, buffered)
  console.info('render', {buffered, videoRef})

  return (
    <div
      className={css(styles.root, isFullScreen && styles.fullScreened)}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleShowController}
      ref={playerRef}
    >
      <div className={css(styles.video)}>
        <Video
          ref={videoRef}
          controls={isMobile && isPlaybackStarted}
          paused={!isPlaying}
          volume={volume}
          onPlay={handleVideoPlay}
          onPause={handleVideoPause}
          onEnded={handleVideoEnded}
          onLoadedData={handleVideoLoadedData}
          onError={handleVideoError}
          onDurationChange={handleVideoDurationChange}
          onTimeUpdate={handleVideoTimeUpdate}
          onWaiting={handleVideoWaiting}
          onPlaying={handleVideoPlaying}
          onSeeking={handleVideoSeeking}
          onSeeked={handleVideoSeeked}
          onProgress={handleVideoProgress}
          onEvent={onEvent}
          useMSE={useMSE}
          useAutoQuality={useAutoQuality}
        />
      </div>
      <div
        className={css(styles.cover, !isPlaybackStarted && styles.coverShown)}
        onClick={() => handlePlay()}
      >
        {cover && (
          <ObjectFitContext.Consumer>
            {({objectFit}) => (
              <img
                className={css(styles.coverImage)}
                src={cover}
                style={{objectFit}}
              />
            )}
          </ObjectFitContext.Consumer>
        )}
        {duration && currentTime === 0 && (
          <div
            className={css(
              styles.coverTime,
              isMobile && styles.coverTimeMobile
            )}
          >
            <Time value={duration} />
          </div>
        )}
        {/* 只有在第一次未播放时展示播放按钮，播放结束全部展示重播按钮 */}
        {isNeverPlayed && (
          <div className={css(styles.coverAction)}>
            <div className={css(styles.actionButton)}>
              <Icon icon={icons.play} styles={styles.actionIcon} />
            </div>
          </div>
        )}
        {/* 重播按钮 */}
        {!isNeverPlayed && currentTime !== 0 && (
          <div className={css(styles.coverReplayAction)}>
            <div
              className={css(
                styles.coverReplayButton,
                hovered && styles.coverReplayButtonHovered,
                pressed && styles.coverReplayButtonPressed
              )}
            >
              <Icon icon={icons.replay} styles={styles.replayIcon} />
              重新播放
            </div>
          </div>
        )}
      </div>
      {!isMobile && (
        <div
          className={css(styles.overlay, isNeverPlayed && styles.overlayMask)}
        >
          {isPlaybackStarted && isLoading && (
            <div className={css(styles.loader)}>
              <Loader />
            </div>
          )}
          {/*直接点击底部播放/暂停按钮时不展示动画*/}
          {lastAction && type !== 'button' && (
            <div className={css(styles.action)} key={lastAction}>
              <div
                className={css(
                  styles.actionButton,
                  styles.actionButtonAnimated
                )}
              >
                <Icon
                  icon={lastAction === 'play' ? icons.play : icons.pause}
                  styles={styles.actionIcon}
                />
              </div>
            </div>
          )}
          <div
            className={css(styles.backdrop)}
            onTouchStart={event => {
              // prevent touch to toggle
              event.preventDefault()
            }}
            onClick={handleToggle}
          />
          {title && isFullScreen && (
            <div
              className={css(styles.title, showController && styles.titleShown)}
            >
              {title}
            </div>
          )}
          {/*首帧已加载完成时展示 MinimalTimeline 组件*/}
          {!hiddenTimeline && isPlaying && (!isLoading || currentTime !== 0) && (
            <div
              className={css(
                hiddenOrShownStyle.base,
                showController
                  ? hiddenOrShownStyle.hidden
                  : hiddenOrShownStyle.shown
              )}
            >
              <MinimalTimeline
                progressDots={progressDots}
                buffered={bufferedTime}
                duration={duration}
                currentTime={currentTime}
                show={!showController}
              />
            </div>
          )}
          {/*首帧已加载完成时展示 Controller 组件*/}
          {isPlaybackStarted && (!isLoading || currentTime !== 0) && (
            <div
              className={css(
                styles.controller,
                hiddenOrShownStyle.base,
                showController
                  ? hiddenOrShownStyle.shown
                  : hiddenOrShownStyle.hidden
              )}
              onMouseEnter={handleControllerPointerEnter}
              onMouseLeave={handleControllerPointerLeave}
            >
              <Controller
                standalone={standalone}
                isPlaying={isPlaying}
                duration={duration}
                currentTime={currentTime}
                volume={volume}
                progressDots={progressDots}
                buffered={bufferedTime}
                isFullScreen={isFullScreen}
                isPip={isPip}
                onDragStart={handleControllerDragStart}
                onDragEnd={handleControllerDragEnd}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                onVolumeChange={handleVideoVolumeChange}
                onToggleFullScreen={handleToggleFullScreen}
                onTogglePip={handleTogglePip}
                show={showController}
                showPip={Pip.supported && !disablePictureInPicture}
                hiddenPlayButton={hiddenPlayButton}
                hiddenTimeline={hiddenTimeline}
                hiddenTime={hiddenTime}
                hiddenQualityMenu={hiddenQualityMenu}
                hiddenVolumeItem={hiddenVolume}
                hiddenFullScreenButton={hiddenFullScreenButton}
              />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className={css(styles.error)}>
          <Icon icon={icons.alert} styles={styles.errorIcon} />
          {error.message && (
            <div className={css(styles.errorMessage)}>{error.message}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default Player
