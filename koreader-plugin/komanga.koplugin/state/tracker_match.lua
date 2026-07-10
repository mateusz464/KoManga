local TrackerMatch = {}
TrackerMatch.__index = TrackerMatch

function TrackerMatch.new(api, manga_id)
    return setmetatable({
        api = api,
        manga_id = manga_id,
        candidates = {},
        selected_index = nil,
        candidate_covers = {},
        state = nil,
        account_linked = false,
        needs_relink = false,
        media_id = nil,
        last_synced_chapter = nil,
        error = nil,
    }, TrackerMatch)
end

function TrackerMatch:getMangaId()
    return self.manga_id
end

function TrackerMatch:getCandidates()
    return self.candidates
end

function TrackerMatch:getSelected()
    return self.selected_index and self.candidates[self.selected_index] or nil
end

function TrackerMatch:getError()
    return self.error
end

function TrackerMatch:getState()
    return self.state
end

function TrackerMatch:isMatched()
    return self.state == "matched"
end

function TrackerMatch:getMediaId()
    return self.media_id
end

function TrackerMatch:getLastSyncedChapter()
    return self.last_synced_chapter
end

function TrackerMatch:needsRelink()
    return self.needs_relink == true
end

function TrackerMatch:fetchCandidates()
    return self.api:trackerCandidates(self.manga_id)
end

function TrackerMatch:applyCandidates(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.candidates = data and data.candidates or {}
    self.selected_index = nil
    self.candidate_covers = {}
    self.error = nil
    return true, nil
end

function TrackerMatch:selectCandidate(index)
    if type(index) ~= "number" or index < 1 or index > #self.candidates then
        return false
    end
    self.selected_index = index
    return true
end

function TrackerMatch:fetchCandidateCover(index)
    local candidate = self.candidates[index]
    if not candidate or type(candidate.coverImageUrl) ~= "string"
            or candidate.coverImageUrl == "" then
        return nil, { kind = "missing" }
    end
    return self.api:fetchTrackerCover(candidate.coverImageUrl)
end

function TrackerMatch:applyCandidateCover(index, bytes, err)
    if err or not bytes then
        self.candidate_covers[index] = { failed = true }
        return false, err
    end
    self.candidate_covers[index] = { bytes = bytes }
    return true, nil
end

function TrackerMatch:getCandidateCover(index)
    local cover = self.candidate_covers[index]
    return cover and cover.bytes or nil
end

function TrackerMatch:isCandidateCoverFailed(index)
    local cover = self.candidate_covers[index]
    return cover ~= nil and cover.failed == true
end

function TrackerMatch:fetchConfirm()
    local selected = self:getSelected()
    if not selected then
        return nil, { kind = "no_selection" }
    end
    return self.api:setTrackerMatch(self.manga_id, selected.mediaId)
end

function TrackerMatch:applyConfirm(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.state = "matched"
    self.media_id = data and data.mediaId or nil
    self.last_synced_chapter = nil
    self.needs_relink = false
    self.error = nil
    return true, nil
end

function TrackerMatch:fetchDoNotTrack()
    return self.api:doNotTrack(self.manga_id)
end

function TrackerMatch:applyDoNotTrack(_data, err)
    if err then
        self.error = err
        return false, err
    end
    self.state = "do_not_track"
    self.media_id = nil
    self.last_synced_chapter = nil
    self.needs_relink = false
    self.error = nil
    return true, nil
end

function TrackerMatch:fetchClear()
    return self.api:clearTrackerMatch(self.manga_id)
end

function TrackerMatch:applyClear(_data, err)
    if err then
        self.error = err
        return false, err
    end
    self.state = "unmatched"
    self.media_id = nil
    self.last_synced_chapter = nil
    self.needs_relink = false
    self.error = nil
    return true, nil
end

function TrackerMatch:fetchStatus()
    return self.api:trackerStatus(self.manga_id)
end

function TrackerMatch:applyStatus(data, err)
    if err then
        self.error = err
        return false, err
    end

    local account = data and data.account
    local media = data and data.media
    self.state = data and data.state or nil
    self.account_linked = type(account) == "table" and account.linked == true
    self.needs_relink = type(account) == "table" and account.needsRelink == true
    self.media_id = self.state == "matched" and type(media) == "table" and media.mediaId or nil
    self.last_synced_chapter = type(data and data.lastSyncedChapter) == "number"
        and data.lastSyncedChapter or nil
    self.error = nil
    return true, nil
end

function TrackerMatch:statusLine()
    if not self.state or self.state == "no_account" or not self.account_linked then
        return nil
    end
    if self.state == "unmatched" then
        return "Tracking: not matched"
    end
    if self.state == "do_not_track" then
        return "Tracking: off"
    end
    if self.state == "matched" then
        if self.needs_relink then
            return "Tracking: re-link needed"
        end
        if self.last_synced_chapter then
            return "Tracking: AniList (synced ch. " .. tostring(self.last_synced_chapter) .. ")"
        end
        return "Tracking: AniList (not synced yet)"
    end
    return nil
end

return TrackerMatch
