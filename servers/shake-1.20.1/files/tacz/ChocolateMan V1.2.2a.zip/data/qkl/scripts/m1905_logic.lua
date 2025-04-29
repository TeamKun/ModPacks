local M = {}

function M.calcSpread(api, ammoCnt, basicInaccuracy)
    local angle = 0.5 - ammoCnt / 10
    return {angle * 10, 0}
end

-- 尝试开火射击时调用
function M.shoot(api)
    -- 先从data文件中获取开火延迟数据，由于以毫秒为单位，因此将秒乘以1000转为毫秒
    local shoot_delay = api:getScriptParams().shoot_delay * 1000
    -- 将执行射击的部分委托为一次性的延时任务，从而达到延迟开火的目的
    api:safeAsyncTask(function ()
        api:shootOnce(false)
        return false
    end,shoot_delay,0,1)
end

function M.start_reload(api)
    -- Initialize cache that will be used in reload ticking
    local cache = {
        is_tactical = api:getReloadStateType() == TACTICAL_RELOAD_FEEDING,
    }
    api:cacheScriptData(cache)
    -- Return true to start ticking
    return true
end

function M.tick_reload(api)
    local cache = api:getCachedScriptData()

    local power_open = api:getScriptParams().power_open * 1000
    local power_feed = api:getScriptParams().power_feed * 1000
    local power_close = api:getScriptParams().power_close * 1000
    local reload_time = api:getReloadTime()

    if (not cache.is_tactical) then
        if (reload_time < power_feed) then
            return TACTICAL_RELOAD_FEEDING, power_feed - reload_time
        elseif (reload_time >= power_feed and reload_time < power_open) then
            api:putAmmoInMagazine(1)
            return TACTICAL_RELOAD_FINISHING, power_open - reload_time
        else
            return NOT_RELOADING, -1
        end
    else
        if (reload_time < power_feed) then
            return EMPTY_RELOAD_FEEDING, power_feed - reload_time
        elseif (reload_time >= power_feed and reload_time < power_close) then
            api:putAmmoInMagazine(1)
            return EMPTY_RELOAD_FINISHING, power_close - reload_time
        else
            return NOT_RELOADING, -1
        end
    end
end

return M