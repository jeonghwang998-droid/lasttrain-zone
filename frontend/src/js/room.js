// html/room.html 담당: 모임방은 대시보드의 '우리 테이블' 로 합쳤으므로 그쪽으로 보낸다

import { url } from './app.js'

const id = new URLSearchParams(location.search).get('id')
location.replace(url('html/dashboard.html') + '?view=group' + (id ? '&room=' + encodeURIComponent(id) : ''))
